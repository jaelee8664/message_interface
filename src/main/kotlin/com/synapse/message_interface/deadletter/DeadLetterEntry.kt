package com.synapse.message_interface.deadletter

import java.time.Instant
import java.util.UUID

data class DeadLetterEntry(
    val id: String = UUID.randomUUID().toString(),
    val traceId: String,
    val workflowUnitId: String,
    val workflowUnitName: String,
    val protocol: String,
    val endpoint: String?,
    val metadata: Map<String, String>,
    /** Original raw message bytes, Base64-encoded. Used for future replay. */
    val rawBytesBase64: String,
    val failedNodeType: String?,
    val errorMessage: String?,
    val timestamp: Instant
)
