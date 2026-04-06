package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.deadletter.DeadLetterStore
import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/dead-letters")
class DeadLetterController(
    private val deadLetterStore: DeadLetterStore,
    private val workflowRegistry: WorkflowRegistry,
    private val workflowDispatcher: WorkflowDispatcher
) {

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

    /**
     * Replays a dead letter against the original workflow unit.
     * The raw message can be edited by the user before replay.
     * Executes the pipeline directly against the specific unit (bypasses condition dispatch).
     */
    @PostMapping("/replay")
    suspend fun replay(@RequestBody req: ReplayRequest): ResponseEntity<ApiResponse<*>> {
        val unit = workflowRegistry.findById(req.workflowUnitId)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error("워크플로우 유닛을 찾을 수 없습니다: ${req.workflowUnitId}"))

        val rawBytes = req.rawMessage.toByteArray(Charsets.UTF_8)
        val format = runCatching { MessageFormat.valueOf(req.format) }.getOrDefault(MessageFormat.JSON)

        val context = MessageContext(
            rawBytes = rawBytes,
            endpoint = req.endpoint,
            protocol = req.protocol,
            metadata = req.metadata
        )

        return try {
            val result = workflowDispatcher.dispatch(context, format)
            val responseBody = result.body?.let { String(it, Charsets.UTF_8) }
            ResponseEntity.ok(ApiResponse.ok(ReplayResult(success = result.isSuccess, responseBody = responseBody)))
        } catch (e: Exception) {
            ResponseEntity.ok(ApiResponse.ok(ReplayResult(success = false, errorMessage = e.message)))
        }
    }
}

data class ReplayRequest(
    val deadLetterId: String,
    val workflowUnitId: String,
    val protocol: String,
    val endpoint: String?,
    val metadata: Map<String, String> = emptyMap(),
    val format: String = "JSON",
    val rawMessage: String
)

data class ReplayResult(
    val success: Boolean,
    val responseBody: String? = null,
    val errorMessage: String? = null
)
