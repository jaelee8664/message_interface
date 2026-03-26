package com.synapse.message_interface.parser

import com.synapse.message_interface.domain.MessageFormat

interface MessageParser {
    val format: MessageFormat
    fun parse(raw: ByteArray): Map<String, Any?>
    fun serialize(data: Map<String, Any?>): ByteArray
}
