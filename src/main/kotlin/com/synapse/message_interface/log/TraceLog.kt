package com.synapse.message_interface.log

import java.time.Instant

data class TraceLog(
    val traceId: String,
    val workflowUnitId: String,
    val nodeType: String,
    val timestamp: Instant,
    val protocol: String,
    val messageSnippet: Map<String, Any?>,  // subset of message fields for search
    val status: TraceStatus,
    val errorMessage: String? = null
)

enum class TraceStatus { SUCCESS, ERROR }
