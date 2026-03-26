package com.synapse.message_interface.parser

import tools.jackson.dataformat.xml.XmlMapper
import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

@Component
class XmlMessageParser : MessageParser {
    override val format = MessageFormat.XML
    private val xmlMapper = XmlMapper()

    @Suppress("UNCHECKED_CAST")
    override fun parse(raw: ByteArray): Map<String, Any?> =
        xmlMapper.readValue(raw, Map::class.java) as Map<String, Any?>

    override fun serialize(data: Map<String, Any?>): ByteArray =
        xmlMapper.writeValueAsBytes(data)
}
