package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.api.dto.TraceSearchRequest
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
     * Trace search — finds traceIds matching the filter groups, then returns all their
     * log entries grouped by traceId in time order.
     *
     * filterGroups: list of AND-groups OR-ed together.
     *   e.g. [[{A=1},{B=2}],[{C=3}]] → (A=1 AND B=2) OR C=3
     * fromDate / toDate: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time).
     */
    @PostMapping("/trace")
    suspend fun trace(@RequestBody request: TraceSearchRequest): ResponseEntity<ApiResponse<*>> {
        val filterGroups = request.filterGroups.map { group ->
            group.map { it.key to it.value }
        }
        val result = logger.searchTraces(
            filterGroups = filterGroups,
            fromFiles = request.fromFiles,
            days = request.days,
            maxTraces = request.maxTraces,
            fromDateStr = request.fromDate,
            toDateStr = request.toDate
        )
        return ResponseEntity.ok(ApiResponse.ok(result))
    }
}
