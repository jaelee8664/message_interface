package com.synapse.message_interface.engine

import com.synapse.message_interface.deadletter.DeadLetterEntry
import com.synapse.message_interface.deadletter.DeadLetterStore
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowNode
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.domain.node.NodeErrorResponse
import com.synapse.message_interface.domain.node.VariableExtraction
import com.synapse.message_interface.log.MessageTraceLogger
import com.synapse.message_interface.log.TraceLog
import com.synapse.message_interface.log.TraceStatus
import com.synapse.message_interface.parser.MessageParserRegistry
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.Base64

/** Carries mutable state through graph traversal. */
private class PipelineState(
    var rawBytes: ByteArray,
    var currentMap: MutableMap<String, Any?> = mutableMapOf()
) {
    fun copy() = PipelineState(rawBytes = rawBytes, currentMap = currentMap.toMutableMap())
}

/**
 * Wraps a pipeline exception to preserve which node failed and the pre-wrap original exception.
 *
 * [failedNode]       — the WorkflowNode whose execution threw.
 * [originalException]— the exception before customErrorMessage wrapping (used for HTTP status derivation).
 * The RuntimeException message/cause is the (possibly wrapped) exception that propagates.
 */
internal class NodeException(
    val failedNode: WorkflowNode,
    val originalException: Exception,
    cause: Exception
) : RuntimeException(cause.message, cause)

@Component
class MessagePipeline(
    private val node1Executor: Node1Executor,
    private val node2Executor: Node2Executor,
    private val node3Executor: Node3Executor,
    private val node4Executor: Node4Executor,
    private val node5Executor: Node5Executor,
    private val traceLogger: MessageTraceLogger,
    private val deadLetterStore: DeadLetterStore,
    private val parserRegistry: MessageParserRegistry
) {

    /**
     * Execute the node pipeline for a given WorkflowUnit by traversing the edge graph.
     *
     * [traceCollector] — optional simulation trace collector. When non-null (simulation mode):
     *   - per-node input/output snapshots and timing are recorded inline
     *   - dead letter saving is skipped (simulated failures are not real events)
     *   All traceCollector operations are no-ops when null — zero overhead in production.
     *
     * Error response priority:
     * 1. If the failing node has its own [WorkflowNode.errorResponse] → use it.
     * 2. Otherwise → use NODE5's [com.synapse.message_interface.domain.node.Node5Definition.defaultErrorConfig].
     */
    suspend fun execute(
        context: MessageContext,
        unit: WorkflowUnit,
        traceCollector: SimulationTraceCollector? = null
    ): PipelineResult {
        val startNode = findStartNode(unit) ?: return PipelineResult(null)
        val state = PipelineState(rawBytes = context.rawBytes)

        return try {
            traverseForward(startNode.id, context, unit, state, mutableSetOf(), traceCollector)
        } catch (e: Exception) {
            val nodeEx = e as? NodeException

            // Skip dead letter saving in simulation mode — simulated failures are not real events
            if (traceCollector == null) {
                deadLetterStore.save(DeadLetterEntry(
                    traceId = context.traceId,
                    workflowUnitId = unit.id,
                    workflowUnitName = unit.name,
                    protocol = context.protocol,
                    endpoint = context.endpoint,
                    metadata = context.metadata,
                    rawBytesBase64 = Base64.getEncoder().encodeToString(context.rawBytes),
                    failedNodeType = nodeEx?.failedNode?.nodeType?.name,
                    errorMessage = (nodeEx?.originalException ?: e).message,
                    timestamp = Instant.now()
                ))
            }

            val node5 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE5 && it.node5 != null }
            if (node5 != null) {
                val errorResponse: NodeErrorResponse =
                    nodeEx?.failedNode?.errorResponse ?: node5.node5!!.defaultErrorConfig
                val originalEx: Exception = nodeEx?.originalException ?: e

                val errorResult = node5Executor.executeError(state.currentMap, errorResponse, originalEx, context.sessionVars)
                if (errorResult.outputMap != null) {
                    logError(context, unit.id, unit.name, NodeType.NODE5, originalEx, errorResult.outputMap)
                }

                unit.edges.firstOrNull { it.sourceNodeId == node5.id }?.let { edge ->
                    try {
                        if (errorResult.outputMap != null) state.currentMap = errorResult.outputMap.toMutableMap()
                        traverseForward(edge.targetNodeId, context, unit, state, mutableSetOf(), traceCollector)
                    } catch (sideEffectEx: Exception) {
                        logError(context, unit.id, unit.name, NodeType.NODE5, sideEffectEx)
                    }
                }

                errorResult
            } else {
                throw e
            }
        }
    }

    // ── Graph traversal ───────────────────────────────────────────────────────

    private fun findStartNode(unit: WorkflowUnit): WorkflowNode? {
        val targetIds = unit.edges.map { it.targetNodeId }.toSet()
        return unit.nodes.firstOrNull { it.nodeType == NodeType.NODE0 }
            ?: unit.nodes.firstOrNull { it.id !in targetIds }
    }

    private suspend fun traverseForward(
        nodeId: String,
        context: MessageContext,
        unit: WorkflowUnit,
        state: PipelineState,
        visited: MutableSet<String>,
        traceCollector: SimulationTraceCollector? = null
    ): PipelineResult {
        if (nodeId in visited) return PipelineResult(null)
        visited.add(nodeId)

        val node = unit.nodes.find { it.id == nodeId } ?: return PipelineResult(null)

        val nodeResult: PipelineResult = when (node.nodeType) {

            NodeType.NODE0 -> {
                val snippet = context.parsedMessage
                    ?.entries?.take(20)?.associate { it.key to it.value }
                    ?: emptyMap()
                logSuccess(context, unit.id, unit.name, node.nodeType, snippet)
                traceCollector?.record(SimulationNodeTrace(
                    nodeId = node.id,
                    nodeType = node.nodeType.name,
                    status = SimulationTraceStatus.SUCCESS,
                    durationMs = 0,
                    inputSnapshot = null,
                    outputSnapshot = snippet
                ))
                PipelineResult(null)
            }

            NodeType.NODE1 -> {
                if (node.node1 != null) {
                    val inputSnapshot = traceCollector?.let { state.currentMap.toMap() }
                    val startMs = traceCollector?.let { System.currentTimeMillis() } ?: 0L
                    try {
                        val preParsed = if (state.currentMap.isEmpty()) context.parsedMessage else null
                        state.currentMap = node1Executor.execute(state.rawBytes, node.node1, preParsed)
                        extractSessionVars(node.node1.variableExtractions, state.currentMap, context)
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.SUCCESS,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = state.currentMap.toMap()
                        ))
                    } catch (e: Exception) {
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.ERROR,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            errorMessage = e.message
                        ))
                        throw wrapAndLog(e, node, context, unit.id, unit.name)
                    }
                }
                PipelineResult(null)
            }

            NodeType.NODE2 -> {
                if (node.node2 != null) {
                    val inputSnapshot = traceCollector?.let { state.currentMap.toMap() }
                    val startMs = traceCollector?.let { System.currentTimeMillis() } ?: 0L
                    try {
                        state.currentMap = node2Executor.execute(state.currentMap, node.node2)
                        extractSessionVars(node.node2.variableExtractions, state.currentMap, context)
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.SUCCESS,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = state.currentMap.toMap()
                        ))
                    } catch (e: Exception) {
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.ERROR,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            errorMessage = e.message
                        ))
                        throw wrapAndLog(e, node, context, unit.id, unit.name)
                    }
                }
                PipelineResult(null)
            }

            NodeType.NODE3 -> {
                if (node.node3 != null) {
                    val inputSnapshot = traceCollector?.let { state.currentMap.toMap() }
                    val startMs = traceCollector?.let { System.currentTimeMillis() } ?: 0L
                    try {
                        state.currentMap = node3Executor.execute(state.currentMap, node.node3)
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.SUCCESS,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = state.currentMap.toMap()
                        ))
                    } catch (e: Exception) {
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.ERROR,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            errorMessage = e.message
                        ))
                        throw wrapAndLog(e, node, context, unit.id, unit.name)
                    }
                }
                PipelineResult(null)
            }

            NodeType.NODE4 -> {
                if (node.node4 != null) {
                    val inputSnapshot = traceCollector?.let { state.currentMap.toMap() }
                    val startMs = traceCollector?.let { System.currentTimeMillis() } ?: 0L
                    try {
                        val responseBytes = node4Executor.execute(state.currentMap, node.node4, context)
                        logSuccess(
                            context, unit.id, unit.name, node.nodeType, state.currentMap,
                            protocol = node.node4.protocol.name,
                            targetInfo = buildTargetInfo(node.node4, context)
                        )
                        if (responseBytes != null) state.rawBytes = responseBytes
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.SUCCESS,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            rawResponse = responseBytes?.toString(Charsets.UTF_8)
                        ))
                        PipelineResult(responseBytes)
                    } catch (e: Exception) {
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.ERROR,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            errorMessage = e.message
                        ))
                        throw wrapAndLog(e, node, context, unit.id, unit.name)
                    }
                } else PipelineResult(null)
            }

            NodeType.NODE5 -> {
                if (node.node5 != null) {
                    val inputSnapshot = traceCollector?.let { state.currentMap.toMap() }
                    val startMs = traceCollector?.let { System.currentTimeMillis() } ?: 0L
                    try {
                        val result = node5Executor.executeSuccess(state.currentMap, node.node5, context.sessionVars)
                        if (result.body != null && result.outputMap != null &&
                            context.protocol == ProtocolType.REST_SERVER.name) {
                            logSuccess(context, unit.id, unit.name, node.nodeType, result.outputMap)
                        }
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.SUCCESS,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = result.outputMap,
                            rawResponse = result.body?.toString(Charsets.UTF_8)
                        ))
                        result
                    } catch (e: Exception) {
                        traceCollector?.record(SimulationNodeTrace(
                            nodeId = node.id,
                            nodeType = node.nodeType.name,
                            status = SimulationTraceStatus.ERROR,
                            durationMs = System.currentTimeMillis() - startMs,
                            inputSnapshot = inputSnapshot,
                            outputSnapshot = null,
                            errorMessage = e.message
                        ))
                        throw wrapAndLog(e, node, context, unit.id, unit.name)
                    }
                } else PipelineResult(null)
            }
        }

        if (node.nodeType == NodeType.NODE5) {
            unit.edges.firstOrNull { it.sourceNodeId == nodeId }?.let { edge ->
                try {
                    if (nodeResult.outputMap != null) state.currentMap = nodeResult.outputMap.toMutableMap()
                    traverseForward(edge.targetNodeId, context, unit, state, visited, traceCollector)
                } catch (e: Exception) {
                    logError(context, unit.id, unit.name, node.nodeType, e)
                }
            }
            return nodeResult
        }

        val nextEdges = unit.edges.filter { it.sourceNodeId == nodeId }
        return when {
            nextEdges.isEmpty() -> nodeResult
            nextEdges.size == 1 -> {
                val downstream = traverseForward(nextEdges[0].targetNodeId, context, unit, state, visited, traceCollector)
                if (downstream.body != null || downstream.httpStatus != 200) downstream else nodeResult
            }
            else -> coroutineScope {
                val results = nextEdges.map { edge ->
                    async {
                        traverseForward(edge.targetNodeId, context, unit, state.copy(), visited.toMutableSet(), traceCollector)
                    }
                }.map { it.await() }
                results.firstOrNull { it.body != null || it.httpStatus != 200 } ?: nodeResult
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun extractSessionVars(
        extractions: List<VariableExtraction>,
        currentMap: Map<String, Any?>,
        context: MessageContext
    ) {
        for (extraction in extractions) {
            val value = FlatMessageAccessor.get(currentMap, extraction.fieldPath)
            if (value != null && value != fieldStatus.NOKEY) {
                context.sessionVars[extraction.variableName] = value.toString()
            }
        }
    }

    private fun wrapAndLog(e: Exception, node: WorkflowNode, context: MessageContext, unitId: String, unitName: String): NodeException {
        val reported = if (!node.customErrorMessage.isNullOrBlank()) RuntimeException(node.customErrorMessage, e) else e
        logError(context, unitId, unitName, node.nodeType, reported)
        return NodeException(failedNode = node, originalException = e, cause = reported)
    }

    private fun buildTargetInfo(def: Node4Definition, context: MessageContext): String? = when (def.protocol) {
        ProtocolType.REST_CLIENT      -> buildUrl(def.targetHost, def.targetPort, def.targetPath)
        ProtocolType.TCP_CLIENT       -> "${def.targetHost ?: "localhost"}:${def.targetPort ?: 9091}"
        ProtocolType.WEBSOCKET_CLIENT -> "ws://${def.targetHost ?: "localhost"}:${def.targetPort ?: 80}${def.targetPath ?: "/"}"
        ProtocolType.KAFKA_PUBLISHER  -> "topic: ${def.targetTopic ?: "-"}"
        ProtocolType.WEBSOCKET_SERVER -> def.targetPath
        ProtocolType.TCP_SERVER       -> def.targetPath ?: context.metadata["channelId"] ?: "TCP_SERVER"
        else -> null
    }

    private fun buildUrl(host: String?, port: Int?, path: String?): String {
        val h = host ?: "localhost"
        val p = port?.let { ":$it" } ?: ""
        val pa = path ?: "/"
        return "http://$h$p$pa"
    }

    private fun logSuccess(
        context: MessageContext,
        unitId: String,
        unitName: String,
        nodeType: NodeType,
        data: Map<String, Any?>,
        protocol: String = context.protocol,
        targetInfo: String? = null
    ) {
        traceLogger.log(TraceLog(
            traceId = context.traceId,
            workflowUnitId = unitId,
            workflowUnitName = unitName,
            nodeType = nodeType.name,
            timestamp = Instant.now(),
            protocol = protocol,
            targetInfo = targetInfo,
            messageSnippet = data.entries.take(10).associate { it.key to it.value },
            status = TraceStatus.SUCCESS
        ))
    }

    private fun logError(
        context: MessageContext,
        unitId: String,
        unitName: String,
        nodeType: NodeType,
        e: Exception,
        returnMessage: Map<String, Any?> = emptyMap()
    ) {
        traceLogger.log(TraceLog(
            traceId = context.traceId,
            workflowUnitId = unitId,
            workflowUnitName = unitName,
            nodeType = nodeType.name,
            timestamp = Instant.now(),
            protocol = context.protocol,
            messageSnippet = returnMessage.entries.take(10).associate { it.key to it.value },
            status = TraceStatus.ERROR,
            errorMessage = e.message
        ))
    }
}
