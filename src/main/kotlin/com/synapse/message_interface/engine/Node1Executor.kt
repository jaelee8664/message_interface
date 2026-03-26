package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.node.Node1Definition
import com.synapse.message_interface.parser.MessageParserRegistry
import org.springframework.stereotype.Component

class ValidationException(message: String) : RuntimeException(message)

@Component
class Node1Executor(private val parserRegistry: MessageParserRegistry) {

    /**
     * Parse raw bytes and validate against Node1Definition.
     * Returns a mutable map of the parsed and validated message.
     */
    fun execute(raw: ByteArray, definition: Node1Definition): MutableMap<String, Any?> {
        val parser = parserRegistry.getParser(definition.messageFormat)
        val parsed = parser.parse(raw).toMutableMap()
        print(parsed)
        for (field in definition.fields) {
            val value = FlatMessageAccessor.get(parsed, field.key)

            // Mandatory check: field must exist in message
            if (field.mandatory && value == null) {
                throw ValidationException("필수 필드 '${field.key}'가 메시지에 존재하지 않습니다.")
            }

            // Nullable check: field value must not be null
            if (!field.nullable && value == null) {
                throw ValidationException("필드 '${field.key}'는 null을 허용하지 않습니다.")
            }
        }

        return parsed
    }
}
