package com.synapse.message_interface.simulator

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.MessagePipeline
import com.synapse.message_interface.engine.SimulationTraceCollector
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.workflow.WorkflowRegistry
import kotlinx.coroutines.delay
import org.springframework.stereotype.Service

@Service
class SimulatorService(
    private val workflowRegistry: WorkflowRegistry,
    private val messagePipeline: MessagePipeline,
    private val parserRegistry: MessageParserRegistry,
    private val scenarioStore: ScenarioStore
) {

    /**
     * Injects a message directly into a specific workflow unit and returns per-node trace results.
     * Dead letters are NOT written — this is a simulation, not a real failure.
     */
    suspend fun simulateUnit(req: SimulateUnitRequest): UnitSimulationResult {
        val unit = workflowRegistry.findById(req.unitId)
            ?: return UnitSimulationResult(
                success = false,
                nodeTraces = emptyList(),
                errorMessage = "유닛을 찾을 수 없습니다: ${req.unitId}"
            )

        val effectiveUnit = applyTargetOverride(unit, req.node4Overrides)
        val rawBytes = req.message.toByteArray(Charsets.UTF_8)
        val format = runCatching { MessageFormat.valueOf(req.format.uppercase()) }.getOrDefault(MessageFormat.JSON)

        val parsedMessage = runCatching {
            parserRegistry.getParser(format).parse(rawBytes).toMutableMap()
        }.getOrNull()

        // Derive protocol and endpoint from NODE0 if not explicitly provided
        val node0 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE0 }
        val effectiveProtocol = req.protocol ?: node0?.node0?.protocol?.name ?: "REST_SERVER"
        val effectiveEndpoint = req.endpoint ?: node0?.node0?.path

        val context = MessageContext(
            rawBytes = rawBytes,
            endpoint = effectiveEndpoint,
            protocol = effectiveProtocol,
            metadata = req.metadata,
            parsedMessage = parsedMessage
        )

        val traceCollector = SimulationTraceCollector()
        val startMs = System.currentTimeMillis()

        return try {
            val result = messagePipeline.execute(context, effectiveUnit, traceCollector)
            UnitSimulationResult(
                success = true,
                nodeTraces = traceCollector.getTraces(),
                response = result.body?.toString(Charsets.UTF_8),
                httpStatus = result.httpStatus,
                durationMs = System.currentTimeMillis() - startMs
            )
        } catch (e: Exception) {
            UnitSimulationResult(
                success = false,
                nodeTraces = traceCollector.getTraces(),
                errorMessage = e.message,
                durationMs = System.currentTimeMillis() - startMs
            )
        }
    }

    /** Runs a saved scenario by ID. */
    suspend fun runScenario(scenarioId: String): ScenarioRunResult {
        val scenario = scenarioStore.findById(scenarioId)
            ?: throw NoSuchElementException("시나리오를 찾을 수 없습니다: $scenarioId")
        return executeScenario(scenario)
    }

    /** Runs a scenario ad-hoc (without saving). */
    suspend fun runAdHoc(scenario: SimulationScenario): ScenarioRunResult =
        executeScenario(scenario)

    private suspend fun executeScenario(scenario: SimulationScenario): ScenarioRunResult {
        val stepResults = mutableListOf<StepResult>()
        val startMs = System.currentTimeMillis()

        for (step in scenario.steps.sortedBy { it.order }) {
            val result = simulateUnit(SimulateUnitRequest(
                unitId = step.unitId,
                message = step.message,
                format = step.format,
                endpoint = step.endpoint,
                protocol = step.protocol,
                metadata = step.metadata,
                node4Overrides = step.node4Overrides
            ))
            stepResults.add(StepResult(
                stepOrder = step.order,
                stepName = step.name,
                unitId = step.unitId,
                result = result
            ))
            if (step.delayAfterMs > 0) delay(step.delayAfterMs)
        }

        return ScenarioRunResult(
            scenarioId = scenario.id,
            scenarioName = scenario.name,
            stepResults = stepResults,
            success = stepResults.all { it.result.success },
            totalDurationMs = System.currentTimeMillis() - startMs
        )
    }

    /** Deep-copies the unit and applies per-NODE4-node host/port overrides for simulation. */
    private fun applyTargetOverride(unit: WorkflowUnit, overrides: Map<String, Node4Override>): WorkflowUnit {
        if (overrides.isEmpty()) return unit
        val modifiedNodes = unit.nodes.map { node ->
            val override = overrides[node.id]
            if (node.nodeType == NodeType.NODE4 && node.node4 != null && override != null) {
                node.copy(node4 = node.node4.copy(
                    targetHost = override.host ?: node.node4.targetHost,
                    targetPort = override.port ?: node.node4.targetPort,
                    targetPath = override.targetIp ?: node.node4.targetPath
                ))
            } else node
        }
        return unit.copy(nodes = modifiedNodes)
    }
}
