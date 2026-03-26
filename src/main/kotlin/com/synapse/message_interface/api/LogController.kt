package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.log.MessageTraceLogger
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import reactor.core.publisher.Mono

@RestController
@RequestMapping("/synapse/logs")
class LogController(private val logger: MessageTraceLogger) {

    @GetMapping("/search")
    fun search(
        @RequestParam fieldKey: String,
        @RequestParam fieldValue: String,
        @RequestParam(defaultValue = "100") limit: Int,
        @RequestParam(defaultValue = "false") fromFiles: Boolean,
        @RequestParam(defaultValue = "7") days: Int
    ): Mono<ResponseEntity<ApiResponse<*>>> {
        val results = if (fromFiles) {
            logger.searchFromFiles(fieldKey, fieldValue, days)
        } else {
            logger.search(fieldKey, fieldValue, limit)
        }
        return Mono.just(ResponseEntity.ok(ApiResponse.ok(results)))
    }
}
