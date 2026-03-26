package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.MessageFormat

/**
 * How NODE5 returns a mandatory server response.
 *
 * NODE5 is limited to protocols that require a response to unblock the caller:
 * - [HTTP_RESPONSE]  – Return an HTTP response to a REST client (httpStatus applies).
 * - [GRPC_RESPONSE]  – Return a gRPC unary response to the caller (isSuccess flag applies).
 *
 * For session-based push (WebSocket, gRPC-bidi, TCP), use NODE4 instead.
 */
enum class Node5ResponseType {
    HTTP_RESPONSE,
    GRPC_RESPONSE
}

/**
 * Configuration for the success response case.
 *
 * The response body is built field-by-field from [fields]:
 * - [NodeErrorFieldSource.LITERAL]  → the fixed string in [NodeErrorField.value]
 * - [NodeErrorFieldSource.FROM_MAP] → the value at [NodeErrorField.value] key in state.currentMap
 * - [NodeErrorFieldSource.EXCEPTION_MESSAGE] → not applicable; treated as null
 *
 * If [fields] is empty the response body is empty (ByteArray(0)).
 *
 * [httpStatus] is only used when [Node5Definition.responseType] is [Node5ResponseType.HTTP_RESPONSE].
 */
data class Node5SuccessConfig(
    val httpStatus: Int = 200,
    val messageFormat: MessageFormat = MessageFormat.JSON,
    val fields: List<NodeErrorField> = emptyList()
)

/**
 * NODE5 – Response node (optional).
 *
 * Determines whether and how the pipeline sends a response/push message.
 * NODE5 is **optional** — a unit without NODE5 simply does not send a response.
 *
 * [responseType] is chosen independently of NODE0's protocol, allowing e.g. a
 * REST-triggered pipeline to push a result over WebSocket.
 *
 * - [successConfig]      – response body built when the pipeline completes without error.
 * - [defaultErrorConfig] – fallback error response for any node without its own
 *   [com.synapse.message_interface.domain.WorkflowNode.errorResponse] override.
 *   HTTP status is auto-derived from the thrown exception
 *   ([org.springframework.web.server.ResponseStatusException] → its code, else 500).
 */
data class Node5Definition(
    val responseType: Node5ResponseType = Node5ResponseType.HTTP_RESPONSE,
    val successConfig: Node5SuccessConfig = Node5SuccessConfig(),
    val defaultErrorConfig: NodeErrorResponse = NodeErrorResponse()
)
