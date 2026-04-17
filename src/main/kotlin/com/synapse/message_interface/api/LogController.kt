package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.log.MessageTraceLogger
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/logs")
class LogController(private val logger: MessageTraceLogger) {

    /** Flat log search — returns raw log entries matching the field value. */
    @GetMapping("/search")
    suspend fun search(
        @RequestParam fieldKey: String,
        @RequestParam fieldValue: String,
        @RequestParam(defaultValue = "200") limit: Int,
        @RequestParam(defaultValue = "false") fromFiles: Boolean,
        @RequestParam(defaultValue = "7") days: Int
    ): ResponseEntity<ApiResponse<*>> {
        val results = if (fromFiles) {
            logger.searchFromFiles(fieldKey, fieldValue, days, limit)
        } else {
            logger.search(fieldKey, fieldValue, limit)
        }
        return ResponseEntity.ok(ApiResponse.ok(results))
    }

    /**
     * Trace search — finds all system traceIds containing the field value,
     * then returns all their log entries grouped by traceId in time order.
     */
    @GetMapping("/trace")
    suspend fun trace(
        @RequestParam(required = false, defaultValue = "") fieldKey: String,
        @RequestParam(required = false, defaultValue = "") fieldValue: String,
        @RequestParam(defaultValue = "true") fromFiles: Boolean,
        @RequestParam(defaultValue = "7") days: Int,
        @RequestParam(required = false) fromDate: String?,
        @RequestParam(required = false) toDate: String?,
        @RequestParam(defaultValue = "50") maxTraces: Int
    ): ResponseEntity<ApiResponse<*>> {
        val result = logger.searchTraces(fieldKey, fieldValue, fromFiles, days, maxTraces, fromDate, toDate)
        return ResponseEntity.ok(ApiResponse.ok(result))
    }
}
