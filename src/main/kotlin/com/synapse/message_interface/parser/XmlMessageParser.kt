package com.synapse.message_interface.parser

import tools.jackson.dataformat.xml.XmlMapper
import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

@Component
class XmlMessageParser : MessageParser {
    override val format = MessageFormat.XML
    private val xmlMapper = XmlMapper()

    @Suppress("UNCHECKED_CAST")
    override fun parse(raw: ByteArray): Map<String, Any?> {
        val parsed = xmlMapper.readValue(raw, Map::class.java) as Map<String, Any?>
        // 루트 엘리먼트(예: <Message>, <Order> 등)를 벗겨내고 내부 내용만 반환
        // → JSON과 동일한 구조로 통일 ({"header": {}, "body": {}})
        return if (parsed.size == 1) {
            (parsed.values.first() as? Map<String, Any?>) ?: parsed
        } else {
            parsed
        }
    }

    override fun serialize(data: Map<String, Any?>): ByteArray =
        xmlMapper.writeValueAsBytes(data)

    override fun serialize(data: Map<String, Any?>, xmlRootElement: String?): ByteArray =
        if (xmlRootElement != null)
            xmlMapper.writer().withRootName(xmlRootElement).writeValueAsBytes(data)
        else
            xmlMapper.writeValueAsBytes(data)
}
