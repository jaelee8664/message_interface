package com.synapse.message_interface.log

import java.time.Instant

data class TraceEntry(
    val traceId: String,
    val firstSeen: Instant,
    val workflowUnitName: String,
    val entries: List<TraceLog>
)

data class TraceSearchResult(
    val filterGroups: List<List<Map<String, String>>>,
    val traces: List<TraceEntry>
)
