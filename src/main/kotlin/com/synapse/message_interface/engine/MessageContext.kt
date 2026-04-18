package com.synapse.message_interface.engine

import java.util.UUID

data class MessageContext(
    val rawBytes: ByteArray,
    val endpoint: String? = null,
    val protocol: String,
    val traceId: String = UUID.randomUUID().toString(),
    val metadata: Map<String, String> = emptyMap(),
    val parsedMessage: MutableMap<String, Any?>? = null,
    val sessionVars: MutableMap<String, String> = mutableMapOf()
)
