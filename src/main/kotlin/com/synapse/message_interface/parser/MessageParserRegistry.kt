package com.synapse.message_interface.parser

import com.synapse.message_interface.domain.MessageFormat
import org.springframework.stereotype.Component

@Component
class MessageParserRegistry(parsers: List<MessageParser>) {
    private val parserMap: Map<MessageFormat, MessageParser> = parsers.associateBy { it.format }

    fun getParser(format: MessageFormat): MessageParser =
        parserMap[format] ?: error("지원하지 않는 메세지 형식: $format")
}
