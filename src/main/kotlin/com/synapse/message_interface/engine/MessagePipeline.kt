package com.synapse.message_interface.engine

import com.synapse.message_interface.deadletter.DeadLetterEntry
import com.synapse.message_interface.deadletter.DeadLetterStore
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowNode
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.domain.node.NodeErrorResponse
import com.synapse.message_interface.log.MessageTraceLogger
import com.synapse.message_interface.log.TraceLog
import com.synapse.message_interface.log.TraceStatus
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.reception.TcpServerSessionRegistry
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
    private val parserRegistry: MessageParserRegistry,
    private val tcpServerSessionRegistry: TcpServerSessionRegistry
) {

    /**
     * Execute the node pipeline for a given WorkflowUnit by traversing the edge graph.
     *
     * Error response priority:
     * 1. If the failing node has its own [WorkflowNode.errorResponse] → use it.
     * 2. Otherwise → use NODE5's [com.synapse.message_interface.domain.node.Node5Definition.defaultErrorConfig].
     *
     * NODE5 is optional. A unit without NODE5 simply produces no response body
     * (and re-throws any uncaught exception to the reception handler).
     */
    suspend fun execute(context: MessageContext, unit: WorkflowUnit): PipelineResult {
        val startNode = findStartNode(unit) ?: return PipelineResult(null)
        val state = PipelineState(rawBytes = context.rawBytes)

        return try {
            traverseForward(startNode.id, context, unit, state, mutableSetOf())
        } catch (e: Exception) {
            val nodeEx = e as? NodeException
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

            val node5 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE5 && it.node5 != null }
            if (node5 != null) {
                // Resolve error response: per-node override takes priority over NODE5 default
                val nodeEx = e as? NodeException
                val errorResponse: NodeErrorResponse =
                    nodeEx?.failedNode?.errorResponse ?: node5.node5!!.defaultErrorConfig
                val originalEx: Exception = nodeEx?.originalException ?: e

                val errorResult = node5Executor.executeError(state.currentMap, errorResponse, originalEx)
                // Log the actual error response being returned to the caller
                if (errorResult.outputMap != null) {
                    logError(context, unit.id, unit.name, NodeType.NODE5, originalEx, errorResult.outputMap)
                }

                // Traverse NODE5's outgoing edges as side effects (e.g. NODE5 → NODE4)
                // Failures here must not override the already-built error response
                unit.edges.firstOrNull { it.sourceNodeId == node5.id }?.let { edge ->
                    try {
                        // Update state with NODE5's error output map so downstream NODE4 serializes the NODE5 DTO
                        if (errorResult.outputMap != null) state.currentMap = errorResult.outputMap.toMutableMap()
                        traverseForward(edge.targetNodeId, context, unit, state, mutableSetOf())
                    } catch (sideEffectEx: Exception) {
                        logError(context, unit.id, unit.name, NodeType.NODE5, sideEffectEx)
                    }
                }

                errorResult
            } else {
                throw e  // No NODE5 — no error response configured; propagate to reception handler
            }
        }
    }

    // ── Graph traversal ───────────────────────────────────────────────────────

    /**
     * Entry node: prefers NODE0. Falls back to the node with no incoming forward edges.
     */
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
        visited: MutableSet<String>
    ): PipelineResult {
        if (nodeId in visited) return PipelineResult(null)   // cycle protection
        visited.add(nodeId)

        val node = unit.nodes.find { it.id == nodeId } ?: return PipelineResult(null)

        val nodeResult: PipelineResult = when (node.nodeType) {

            NodeType.NODE0 -> {
                // Log the raw incoming message at the reception boundary
                val snippet = context.parsedMessage
                    ?.entries?.take(20)?.associate { it.key to it.value }
                    ?: emptyMap()
                logSuccess(context, unit.id, unit.name, node.nodeType, snippet)
                PipelineResult(null)
            }

            NodeType.NODE1 -> {
                if (node.node1 != null) {
                    try {
                        // Only use pre-parsed context message for the first NODE1 (no prior processing).
                        // Subsequent NODE1 nodes (e.g. parsing a NODE4 response) must parse state.rawBytes fresh.
                        val preParsed = if (state.currentMap.isEmpty()) context.parsedMessage else null
                        state.currentMap = node1Executor.execute(state.rawBytes, node.node1, preParsed)
                    } catch (e: Exception) { throw wrapAndLog(e, node, context, unit.id, unit.name) }
                }
                PipelineResult(null)
            }

            NodeType.NODE2 -> {
                if (node.node2 != null) {
                    try {
                        state.currentMap = node2Executor.execute(state.currentMap, node.node2)
                    } catch (e: Exception) { throw wrapAndLog(e, node, context, unit.id, unit.name) }
                }
                PipelineResult(null)
            }

            NodeType.NODE3 -> {
                if (node.node3 != null) {
                    try {
                        state.currentMap = node3Executor.execute(state.currentMap, node.node3)
                    } catch (e: Exception) { throw wrapAndLog(e, node, context, unit.id, unit.name) }
                }
                PipelineResult(null)
            }

            NodeType.NODE4 -> {
                if (node.node4 != null) {
                    try {
                        val responseBytes = node4Executor.execute(state.currentMap, node.node4, context)
                        logSuccess(
                            context, unit.id, unit.name, node.nodeType, state.currentMap,
                            protocol = node.node4.protocol.name,
                            targetInfo = buildTargetInfo(node.node4, context)
                        )
                        if (responseBytes != null) {
                            state.rawBytes = responseBytes
                        }
                        PipelineResult(responseBytes)
                    } catch (e: Exception) { throw wrapAndLog(e, node, context, unit.id, unit.name) }
                } else PipelineResult(null)
            }

            NodeType.NODE5 -> {
                if (node.node5 != null) {
                    try {
                        val result = node5Executor.executeSuccess(state.currentMap, node.node5)
                        // Log NODE5 only for REST_SERVER: it directly sends the HTTP response.
                        // For other protocols (TCP, WebSocket, etc.) NODE5 just formats the body;
                        // NODE4 handles the actual transmission and is already logged.
                        if (result.body != null && result.outputMap != null &&
                            context.protocol == ProtocolType.REST_SERVER.name) {
                            logSuccess(context, unit.id, unit.name, node.nodeType, result.outputMap)
                        }
                        result
                    } catch (e: Exception) { throw wrapAndLog(e, node, context, unit.id, unit.name) }
                } else PipelineResult(null)
            }
        }

        // NODE5: run downstream edges as side effects (e.g. NODE5 → NODE4 for additional delivery),
        // but always return NODE5's own result as the authoritative server response.
        if (node.nodeType == NodeType.NODE5) {
            unit.edges.firstOrNull { it.sourceNodeId == nodeId }?.let { edge ->
                try {
                    // Update state with NODE5's output map so downstream NODE4 serializes the NODE5 DTO
                    if (nodeResult.outputMap != null) state.currentMap = nodeResult.outputMap.toMutableMap()
                    traverseForward(edge.targetNodeId, context, unit, state, visited)
                } catch (e: Exception) {
                    logError(context, unit.id, unit.name, node.nodeType, e)
                }
            }
            return nodeResult
        }

        // All other nodes: follow outgoing edges — single edge continues sequentially,
        // multiple edges execute in parallel (fan-out), each with its own state copy.
        val nextEdges = unit.edges.filter { it.sourceNodeId == nodeId }
        return when {
            nextEdges.isEmpty() -> nodeResult
            nextEdges.size == 1 -> {
                val downstream = traverseForward(nextEdges[0].targetNodeId, context, unit, state, visited)
                if (downstream.body != null || downstream.httpStatus != 200) downstream else nodeResult
            }
            else -> coroutineScope {
                val results = nextEdges.map { edge ->
                    async {
                        traverseForward(edge.targetNodeId, context, unit, state.copy(), visited.toMutableSet())
                    }
                }.map { it.await() }
                // Return the first result that carries a response body or non-200 status
                results.firstOrNull { it.body != null || it.httpStatus != 200 } ?: nodeResult
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun wrapAndLog(e: Exception, node: WorkflowNode, context: MessageContext, unitId: String, unitName: String): NodeException {
        val reported = if (!node.customErrorMessage.isNullOrBlank()) RuntimeException(node.customErrorMessage, e) else e
        logError(context, unitId, unitName, node.nodeType, reported)
        // Keep 'e' as originalException so ResponseStatusException status can be derived correctly
        return NodeException(failedNode = node, originalException = e, cause = reported)
    }

    private fun buildTargetInfo(def: Node4Definition, context: MessageContext): String? = when (def.protocol) {
        ProtocolType.REST_CLIENT      -> buildUrl(def.targetHost, def.targetPort, def.targetPath)
        ProtocolType.TCP_CLIENT       -> "${def.targetHost ?: "localhost"}:${def.targetPort ?: 9091}"
        ProtocolType.WEBSOCKET_CLIENT -> "ws://${def.targetHost ?: "localhost"}:${def.targetPort ?: 80}${def.targetPath ?: "/"}"
        ProtocolType.KAFKA_PUBLISHER  -> "topic: ${def.targetTopic ?: "-"}"
        ProtocolType.WEBSOCKET_SERVER -> def.targetPath
        ProtocolType.TCP_SERVER       -> {
            val channelId = def.targetPath ?: context.metadata["channelId"]
            channelId?.let { tcpServerSessionRegistry.getRemoteAddress(it) } ?: "TCP_SERVER"
        }
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
