package com.synapse.message_interface.log

import java.time.Instant

data class TraceLog(
    val traceId: String,
    val workflowUnitId: String,
    val workflowUnitName: String = "",
    val nodeType: String,
    val timestamp: Instant,
    val protocol: String,
    val targetInfo: String? = null,   // NODE4 송신 대상 (host:port, topic 등)
    val messageSnippet: Map<String, Any?>,
    val status: TraceStatus,
    val errorMessage: String? = null
)

enum class TraceStatus { SUCCESS, ERROR }
