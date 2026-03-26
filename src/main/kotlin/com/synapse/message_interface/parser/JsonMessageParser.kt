package com.synapse.message_interface.parser

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

@Component
class JsonMessageParser(private val objectMapper: ObjectMapper) : MessageParser {
    override val format = MessageFormat.JSON

    @Suppress("UNCHECKED_CAST")
    override fun parse(raw: ByteArray): Map<String, Any?> =
        objectMapper.readValue(raw, Map::class.java) as Map<String, Any?>

    override fun serialize(data: Map<String, Any?>): ByteArray =
        objectMapper.writeValueAsBytes(data)
}
