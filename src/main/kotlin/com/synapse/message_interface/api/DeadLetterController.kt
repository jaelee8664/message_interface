package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.deadletter.DeadLetterStore
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/dead-letters")
class DeadLetterController(private val deadLetterStore: DeadLetterStore) {

    /** Returns recent dead letter entries (in-memory first, then files if fromFiles=true). */
    @GetMapping
    suspend fun list(
        @RequestParam(defaultValue = "7") days: Int,
        @RequestParam(defaultValue = "200") limit: Int,
        @RequestParam(defaultValue = "false") fromFiles: Boolean
    ): ResponseEntity<ApiResponse<*>> {
        val entries = if (fromFiles) {
            deadLetterStore.searchFromFiles(days, limit)
        } else {
            deadLetterStore.getRecent(limit, days)
        }
        return ResponseEntity.ok(ApiResponse.ok(entries))
    }
}
