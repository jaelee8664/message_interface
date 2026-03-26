package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.node.Node5Definition
import com.synapse.message_interface.domain.node.Node5SuccessConfig
import com.synapse.message_interface.domain.node.NodeErrorFieldSource
import com.synapse.message_interface.domain.node.NodeErrorResponse
import com.synapse.message_interface.parser.MessageParserRegistry
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException

@Component
class Node5Executor(private val parserRegistry: MessageParserRegistry) {

    /** Called when the pipeline completes without error. */
    fun executeSuccess(data: Map<String, Any?>, definition: Node5Definition): PipelineResult {
        val config = definition.successConfig
        val body = buildSuccessBody(data, config)
        return PipelineResult(body = body, httpStatus = config.httpStatus, isSuccess = true)
    }

    /**
     * Called when an upstream node throws an exception.
     *
     * HTTP status is derived from the exception:
     * - [ResponseStatusException] → its status code
     * - Any other exception → 500
     *
     * The [errorResponse] is either the per-node override or NODE5's [Node5Definition.defaultErrorConfig].
     */
    fun executeError(
        data: Map<String, Any?>,
        errorResponse: NodeErrorResponse,
        exception: Throwable
    ): PipelineResult {
        val httpStatus = if (exception is ResponseStatusException) exception.statusCode.value() else 500
        val body = buildErrorBody(data, errorResponse, exception)
        return PipelineResult(body = body, httpStatus = httpStatus, isSuccess = false)
    }

    // ── Private builders ──────────────────────────────────────────────────────

    private fun buildSuccessBody(data: Map<String, Any?>, config: Node5SuccessConfig): ByteArray? {
        if (config.fields.isEmpty()) return ByteArray(0)
        val resultMap = mutableMapOf<String, Any?>()
        for (field in config.fields) {
            resultMap[field.key] = when (field.source) {
                NodeErrorFieldSource.LITERAL  -> field.value
                NodeErrorFieldSource.FROM_MAP -> data[field.value]
                NodeErrorFieldSource.EXCEPTION_MESSAGE -> null  // not applicable for success
            }
        }
        return parserRegistry.getParser(config.messageFormat).serialize(resultMap)
    }

    private fun buildErrorBody(
        data: Map<String, Any?>,
        errorResponse: NodeErrorResponse,
        exception: Throwable
    ): ByteArray? {
        val resultMap = mutableMapOf<String, Any?>()
        for (field in errorResponse.fields) {
            resultMap[field.key] = when (field.source) {
                NodeErrorFieldSource.LITERAL          -> field.value
                NodeErrorFieldSource.FROM_MAP         -> data[field.value]
                NodeErrorFieldSource.EXCEPTION_MESSAGE -> exception.message ?: "알 수 없는 오류"
            }
        }
        return parserRegistry.getParser(errorResponse.messageFormat).serialize(resultMap)
    }
}
