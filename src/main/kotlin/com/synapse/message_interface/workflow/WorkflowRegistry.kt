package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.ConditionType
import com.synapse.message_interface.domain.LogicalOp
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.WorkflowCondition
import com.synapse.message_interface.domain.WorkflowTree
import com.synapse.message_interface.domain.WorkflowUnit
import org.springframework.stereotype.Component
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ConcurrentHashMap

private val WILDCARD_CHARS = setOf('{', '*', '?')

data class DispatchIndex(
    val exactEndpointIndex: Map<String, WorkflowUnit>,
    val wildcardEndpointUnits: List<WorkflowUnit>,
    val compositeExactEndpointIndex: Map<String, List<WorkflowUnit>>,
    val compositeWildcardEndpointUnits: List<WorkflowUnit>,
    val noEndpointUnits: List<WorkflowUnit>
)

@Component
class WorkflowRegistry {
    private val tree = CopyOnWriteArrayList<WorkflowUnit>()

    /** id → unit: O(1) lookup */
    private val idIndex = ConcurrentHashMap<String, WorkflowUnit>()

    /** exact ENDPOINT pattern → unit: O(1) lookup */
    @Volatile private var exactEndpointIndex: Map<String, WorkflowUnit> = emptyMap()

    /** ENDPOINT units with wildcards, sorted by pattern length descending (specificity) */
    @Volatile private var wildcardEndpointUnits: List<WorkflowUnit> = emptyList()

    /** composite units with a required exact ENDPOINT in AND chain: endpoint → units */
    @Volatile private var compositeExactEndpointIndex: Map<String, List<WorkflowUnit>> = emptyMap()

    /** composite units with a required wildcard ENDPOINT in AND chain */
    @Volatile private var compositeWildcardEndpointUnits: List<WorkflowUnit> = emptyList()

    /** units with no indexable endpoint (FIELD_VALUE/CONTAINS_KEY leaves, OR composites, etc.) */
    @Volatile private var noEndpointUnits: List<WorkflowUnit> = emptyList()

    /** protocol name (ProtocolType.name) → DispatchIndex for that protocol's units only */
    @Volatile private var protocolDispatchIndex: Map<String, DispatchIndex> = emptyMap()

    fun getAll(): List<WorkflowUnit> = tree.toList()

    fun getIndexed(): DispatchIndex = DispatchIndex(
        exactEndpointIndex,
        wildcardEndpointUnits,
        compositeExactEndpointIndex,
        compositeWildcardEndpointUnits,
        noEndpointUnits
    )

    /** Returns a protocol-scoped DispatchIndex, or null if no units exist for that protocol. */
    fun getIndexedByProtocol(protocol: String): DispatchIndex? = protocolDispatchIndex[protocol]

    fun load(workflowTree: WorkflowTree) {
        tree.clear()
        tree.addAll(workflowTree.units)
        rebuildIndex()
    }

    fun addOrUpdate(unit: WorkflowUnit) {
        tree.removeIf { it.id == unit.id }
        tree.add(unit)
        rebuildIndex()
    }

    fun remove(unitId: String) {
        tree.removeIf { it.id == unitId }
        rebuildIndex()
    }

    fun findById(unitId: String): WorkflowUnit? = idIndex[unitId]

    /**
     * Extracts endpoint patterns that are REQUIRED by the condition —
     * i.e., if the endpoint doesn't match, the whole condition will fail.
     *
     * Only AND chains guarantee this: OR means the endpoint sub-condition
     * is optional, so we can't use it as a safe index key.
     */
    private fun extractRequiredEndpointPatterns(condition: WorkflowCondition): Set<String> {
        if (condition.type == ConditionType.ENDPOINT && condition.endpointPattern != null)
            return setOf(condition.endpointPattern)
        if (condition.logicalOp == LogicalOp.AND && condition.subConditions != null) {
            for (sub in condition.subConditions) {
                val patterns = extractRequiredEndpointPatterns(sub)
                if (patterns.isNotEmpty()) return patterns
            }
        }
        return emptySet()
    }

    private fun buildDispatchIndex(units: List<WorkflowUnit>): DispatchIndex {
        val (endpointOnly, others) = units.partition {
            it.condition.type == ConditionType.ENDPOINT && it.condition.logicalOp == null
        }

        val (exact, wildcard) = endpointOnly.partition { unit ->
            unit.condition.endpointPattern?.none { it in WILDCARD_CHARS } == true
        }

        val compositeExact = mutableMapOf<String, MutableList<WorkflowUnit>>()
        val compositeWildcard = mutableListOf<WorkflowUnit>()
        val noEndpoint = mutableListOf<WorkflowUnit>()

        for (unit in others) {
            val patterns = extractRequiredEndpointPatterns(unit.condition)
            if (patterns.isEmpty()) {
                noEndpoint.add(unit)
            } else {
                val (exactPatterns, wildcardPatterns) = patterns.partition { p -> p.none { it in WILDCARD_CHARS } }
                exactPatterns.forEach { p -> compositeExact.getOrPut(p) { mutableListOf() }.add(unit) }
                if (wildcardPatterns.isNotEmpty()) compositeWildcard.add(unit)
            }
        }

        return DispatchIndex(
            exactEndpointIndex = exact.associate { it.condition.endpointPattern!! to it },
            wildcardEndpointUnits = wildcard.sortedByDescending { it.condition.endpointPattern?.length ?: 0 },
            compositeExactEndpointIndex = compositeExact,
            compositeWildcardEndpointUnits = compositeWildcard,
            noEndpointUnits = noEndpoint
        )
    }

    private fun rebuildIndex() {
        val all = tree.toList()

        idIndex.clear()
        all.forEach { idIndex[it.id] = it }

        val globalIndex = buildDispatchIndex(all)
        exactEndpointIndex = globalIndex.exactEndpointIndex
        wildcardEndpointUnits = globalIndex.wildcardEndpointUnits
        compositeExactEndpointIndex = globalIndex.compositeExactEndpointIndex
        compositeWildcardEndpointUnits = globalIndex.compositeWildcardEndpointUnits
        noEndpointUnits = globalIndex.noEndpointUnits

        protocolDispatchIndex = all
            .groupBy { unit ->
                unit.nodes.find { it.nodeType == NodeType.NODE0 }?.node0?.protocol?.name
            }
            .filterKeys { it != null }
            .mapKeys { it.key!! }
            .mapValues { (_, units) -> buildDispatchIndex(units) }
    }
}
