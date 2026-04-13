package com.synapse.message_interface.parser

import com.synapse.message_interface.domain.MessageFormat

interface MessageParser {
    val format: MessageFormat
    fun parse(raw: ByteArray): Map<String, Any?>
    fun serialize(data: Map<String, Any?>): ByteArray
    /** XML 전용: xmlRootElement가 있으면 해당 이름으로 루트 태그를 감싸 직렬화한다. 기본 구현은 무시. */
    fun serialize(data: Map<String, Any?>, xmlRootElement: String?): ByteArray = serialize(data)
}
