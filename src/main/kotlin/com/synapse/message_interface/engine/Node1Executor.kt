package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.node.CustomDtoDefinition
import com.synapse.message_interface.domain.node.Node1Definition
import com.synapse.message_interface.parser.MessageParserRegistry
import org.springframework.stereotype.Component

@Component
class Node1Executor(
    private val parserRegistry: MessageParserRegistry,
) {

    fun execute(
        raw: ByteArray,
        definition: Node1Definition,
        preParsed: MutableMap<String, Any?>? = null
    ): MutableMap<String, Any?> {
        val parsed = preParsed
            ?: parserRegistry.getParser(definition.messageFormat).parse(raw).toMutableMap()

        for (field in definition.fields) {
            validateField(parsed, field, definition.customDtos, "")
        }
        return parsed
    }

    private fun validateField(
        parsed: Map<String, Any?>,
        field: FieldDefinition,
        customDtos: List<CustomDtoDefinition>,
        keyPrefix: String
    ) {
        val fullKey = if (keyPrefix.isEmpty()) field.key else "$keyPrefix.${field.key}"
        val value = FlatMessageAccessor.get(parsed, fullKey)

        if (field.mandatory && value == fieldStatus.NOKEY) {
            throw IllegalArgumentException("Mandatory key '$fullKey' doesn't exist in field")
        }

        if (!field.nullable && value == null) {
            throw IllegalArgumentException("field key '$fullKey' doesn't allow nullable value")
        }

        if (field.type == FieldType.CUSTOM && field.customTypeName != null && value != null && value != fieldStatus.NOKEY) {
            val customDto = customDtos.find { it.name == field.customTypeName }
                ?: throw IllegalArgumentException("CustomDtoDefinition '${field.customTypeName}' not found")
            for (subField in customDto.fields) {
                validateField(parsed, subField, customDtos, fullKey)
            }
        }
    }
}
