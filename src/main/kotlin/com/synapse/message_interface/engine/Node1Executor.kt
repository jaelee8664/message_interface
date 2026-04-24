package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.MessageFormat
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
        // PROTOBUF(gRPC): DynamicMessage → Map 변환이 핸들러에서 이미 완료되어 preParsed 로 전달됨.
        // parser 호출 없이 preParsed 를 그대로 사용하며, 이후 fields 유효성 검사는 동일하게 수행.
        val parsed = when {
            definition.messageFormat == MessageFormat.PROTOBUF && preParsed != null -> preParsed
            preParsed != null -> preParsed
            else -> parserRegistry.getParser(definition.messageFormat).parse(raw).toMutableMap()
        }

        for (field in definition.fields) {
            validateField(parsed, field, definition.customDtos, "")
        }
        return parsed
    }

    private fun validateField(
        parsed: MutableMap<String, Any?>,
        field: FieldDefinition,
        customDtos: List<CustomDtoDefinition>,
        keyPrefix: String
    ) {
        val fullKey = if (keyPrefix.isEmpty()) field.key else "$keyPrefix.${field.key}"
        val value = FlatMessageAccessor.get(parsed, fullKey)

        if (value == fieldStatus.NOKEY) {
            if (field.mandatory) {
                throw IllegalArgumentException("Mandatory key '$fullKey' doesn't exist in field")
            }
            FlatMessageAccessor.set(parsed, fullKey, if (field.nullable) null else convertDefaultValue(field))
            return
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

    private fun convertDefaultValue(field: FieldDefinition): Any? {
        val raw = field.defaultValue
        return when (field.type) {
            FieldType.STRING  -> raw ?: ""
            FieldType.INT     -> if (raw != null)
                raw.toIntOrNull()
                    ?: throw IllegalArgumentException("defaultValue '$raw' is not a valid INT for field '${field.key}'")
                else 0
            FieldType.DOUBLE  -> if (raw != null)
                raw.toDoubleOrNull()
                    ?: throw IllegalArgumentException("defaultValue '$raw' is not a valid DOUBLE for field '${field.key}'")
                else 0.0
            FieldType.BOOLEAN -> if (raw != null)
                raw.toBooleanStrictOrNull()
                    ?: throw IllegalArgumentException("defaultValue '$raw' is not a valid BOOLEAN for field '${field.key}'")
                else false
            FieldType.LIST    -> mutableListOf<Any?>()
            FieldType.MAP     -> mutableMapOf<String, Any?>()
            FieldType.CUSTOM  -> null
        }
    }
}
