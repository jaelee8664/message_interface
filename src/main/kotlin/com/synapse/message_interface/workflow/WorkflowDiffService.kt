package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.WorkflowNode
import com.synapse.message_interface.domain.WorkflowTree
import tools.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service

// ── DTOs ─────────────────────────────────────────────────────────────────────

data class FieldDiff(
    val field: String,
    val before: String?,
    val after: String?
)

data class NodeDiff(
    val nodeType: String,
    val status: String,       // ADDED | REMOVED | MODIFIED | UNCHANGED
    val fieldDiffs: List<FieldDiff>
)

data class UnitDiff(
    val id: String,
    val beforeName: String?,
    val afterName: String?,
    val status: String,       // ADDED | REMOVED | MODIFIED | UNCHANGED
    val nodeDiffs: List<NodeDiff>
)

data class WorkflowDiffResult(
    val version: Int,
    val modifiedBy: String,
    val modifiedAt: String,
    val unitDiffs: List<UnitDiff>
)

// ── Service ───────────────────────────────────────────────────────────────────

@Service
class WorkflowDiffService(private val objectMapper: ObjectMapper) {

    fun diff(beforeEntry: WorkflowHistoryEntry, afterTree: WorkflowTree): WorkflowDiffResult {
        val beforeById = beforeEntry.tree.units.associateBy { it.id }
        val afterById  = afterTree.units.associateBy { it.id }
        val allIds     = (beforeById.keys + afterById.keys).toSet()

        val unitDiffs = allIds.map { id ->
            val bu = beforeById[id]
            val au = afterById[id]
            when {
                bu == null -> UnitDiff(
                    id, null, au!!.name, "ADDED",
                    nodeDiffsForUnit(emptyList(), au.nodes)
                )
                au == null -> UnitDiff(
                    id, bu.name, null, "REMOVED",
                    nodeDiffsForUnit(bu.nodes, emptyList())
                )
                else -> {
                    val nodeDiffs = nodeDiffsForUnit(bu.nodes, au.nodes)
                    val nameChanged = bu.name != au.name
                    val status = if (nameChanged || nodeDiffs.any { it.status != "UNCHANGED" })
                        "MODIFIED" else "UNCHANGED"
                    UnitDiff(id, bu.name, au.name, status, nodeDiffs)
                }
            }
        }.sortedWith(
            compareByDescending<UnitDiff> { it.status != "UNCHANGED" }
                .thenBy { it.status }
        )

        return WorkflowDiffResult(
            version    = beforeEntry.version,
            modifiedBy = beforeEntry.modifiedBy,
            modifiedAt = beforeEntry.modifiedAt,
            unitDiffs  = unitDiffs
        )
    }

    // ── node-level diff ───────────────────────────────────────────────────────

    private fun nodeDiffsForUnit(
        beforeNodes: List<WorkflowNode>,
        afterNodes:  List<WorkflowNode>
    ): List<NodeDiff> {
        val beforeByType = beforeNodes.groupBy { it.nodeType }
        val afterByType  = afterNodes.groupBy  { it.nodeType }
        val allTypes     = (beforeByType.keys + afterByType.keys).toSet()
            .sortedBy { it.ordinal }

        return allTypes.flatMap { type ->
            val bs  = beforeByType[type] ?: emptyList()
            val `as` = afterByType[type]  ?: emptyList()
            val len = maxOf(bs.size, `as`.size)
            (0 until len).map { i ->
                val bn = bs.getOrNull(i)
                val an = `as`.getOrNull(i)
                nodeDiff(type, bn, an)
            }
        }
    }

    private fun nodeDiff(type: NodeType, before: WorkflowNode?, after: WorkflowNode?): NodeDiff {
        val bMap = toMap(nodeDefOf(before))
        val aMap = toMap(nodeDefOf(after))

        return when {
            before == null -> NodeDiff(
                type.name, "ADDED",
                aMap.map { (k, v) -> FieldDiff(k, null, stringify(v)) }
            )
            after == null -> NodeDiff(
                type.name, "REMOVED",
                bMap.map { (k, v) -> FieldDiff(k, stringify(v), null) }
            )
            else -> {
                val allKeys = (bMap.keys + aMap.keys).toSet()
                val diffs = allKeys.mapNotNull { k ->
                    val bv = stringify(bMap[k])
                    val av = stringify(aMap[k])
                    if (bv != av) FieldDiff(k, bv, av) else null
                }.sortedBy { it.field }
                NodeDiff(type.name, if (diffs.isEmpty()) "UNCHANGED" else "MODIFIED", diffs)
            }
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private fun nodeDefOf(node: WorkflowNode?): Any? = node?.let {
        when (it.nodeType) {
            NodeType.NODE0 -> it.node0
            NodeType.NODE1 -> it.node1
            NodeType.NODE2 -> it.node2
            NodeType.NODE3 -> it.node3
            NodeType.NODE4 -> it.node4
            NodeType.NODE5 -> it.node5
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun toMap(def: Any?): Map<String, Any?> {
        if (def == null) return emptyMap()
        val json = objectMapper.writeValueAsString(def)
        return objectMapper.readValue(json, Map::class.java) as Map<String, Any?>
    }

    private fun stringify(value: Any?): String? = when (value) {
        null            -> null
        is String       -> value
        is Number,
        is Boolean      -> value.toString()
        else            -> objectMapper.writeValueAsString(value)
    }
}
