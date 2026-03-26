package com.synapse.message_interface.parser

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

@Component
class ProtobufMessageParser(private val objectMapper: ObjectMapper) : MessageParser {
    override val format = MessageFormat.PROTOBUF

    /**
     * For DynamicMessage parsing, we expect raw bytes with a registered descriptor.
     * In practice, protobuf descriptors must be registered at runtime.
     * This implementation converts protobuf JSON (text) representation for dynamic use.
     */
    @Suppress("UNCHECKED_CAST")
    override fun parse(raw: ByteArray): Map<String, Any?> {
        // Parse as JSON intermediate representation for dynamic message support
        // In production: use registered FileDescriptorProto to build DynamicMessage
        return objectMapper.readValue(raw, Map::class.java) as Map<String, Any?>
    }

    override fun serialize(data: Map<String, Any?>): ByteArray =
        objectMapper.writeValueAsBytes(data)
}
