package com.synapse.message_interface.reception

import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.server.ServerWebExchange

@RestController
class RestServerHandler(private val dispatcher: WorkflowDispatcher) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping("/**")
    suspend fun receive(@RequestBody body: ByteArray, exchange: ServerWebExchange): ResponseEntity<ByteArray> {
        val endpoint = exchange.request.path.pathWithinApplication().value()
        val ctx = MessageContext(
            rawBytes = body,
            endpoint = endpoint,
            protocol = "REST_SERVER"
        )
        return try {
            val result = dispatcher.dispatch(ctx)
            val status = HttpStatus.resolve(result.httpStatus) ?: HttpStatus.INTERNAL_SERVER_ERROR
            ResponseEntity.status(status).body(result.body ?: ByteArray(0))
        } catch (e: Exception) {
            log.error("[REST Server] 처리 오류 path=$endpoint: ${e.message}", e)
            val errorStatus = if (e is ResponseStatusException) e.statusCode.value() else 500
            val httpStatus = HttpStatus.resolve(errorStatus) ?: HttpStatus.INTERNAL_SERVER_ERROR
            ResponseEntity.status(httpStatus)
                .body(e.message?.toByteArray() ?: ByteArray(0))
        }
    }
}
