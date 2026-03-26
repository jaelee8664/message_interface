package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.MessageFormat

/** Where the value for a single error-response field comes from. */
enum class NodeErrorFieldSource {
    LITERAL,            // [value] is used verbatim as a fixed string
    FROM_MAP,           // [value] is a key into state.currentMap at the time of the error
    EXCEPTION_MESSAGE   // exception.message is injected (value is ignored)
}

/**
 * A single field in the error response body.
 *
 * @param key    The JSON key in the response body.
 * @param source How the runtime value is resolved.
 * @param value  LITERAL → the fixed string; FROM_MAP → the currentMap key; EXCEPTION_MESSAGE → ignored.
 */
data class NodeErrorField(
    val key: String,
    val source: NodeErrorFieldSource,
    val value: String = ""
)

/**
 * Describes the error response body that is returned when a node fails.
 *
 * Used in two places:
 * - [com.synapse.message_interface.domain.node.Node5Definition.defaultErrorConfig] —
 *   the fallback used for any node that does not define its own [com.synapse.message_interface.domain.WorkflowNode.errorResponse].
 * - [com.synapse.message_interface.domain.WorkflowNode.errorResponse] —
 *   a per-node override that takes precedence over the NODE5 default.
 *
 * HTTP status is always auto-derived from the exception:
 * - [org.springframework.web.server.ResponseStatusException] → its status code
 * - Any other exception → 500
 */
data class NodeErrorResponse(
    val messageFormat: MessageFormat = MessageFormat.JSON,
    val fields: List<NodeErrorField> = emptyList()
)
