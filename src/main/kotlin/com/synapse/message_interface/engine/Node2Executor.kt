package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.FieldType
import com.synapse.message_interface.domain.node.Node2Definition
import com.synapse.message_interface.script.JavaScriptExecutor
import org.springframework.stereotype.Component

class CustomValueTransformException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Component
class Node2Executor(private val scriptExecutor: JavaScriptExecutor) {

    /**
     * Apply all transform rules to the parsed message map.
     * Returns a new mutable map with transforms applied.
     */
    suspend fun execute(data: MutableMap<String, Any?>, definition: Node2Definition): MutableMap<String, Any?> {
        val result = data.toMutableMap()

        // 1. Value replace rules
        for (rule in definition.valueReplaceRules) {
            val current = FlatMessageAccessor.get(result, rule.key)
            if (current?.toString() == rule.matchValue) {
                FlatMessageAccessor.set(result, rule.key, rule.afterValue)
            }
        }

        // 2. Type convert rules
        for (rule in definition.typeConvertRules) {
            val current = FlatMessageAccessor.get(result, rule.key)
            val converted = convertType(current, rule.afterType, rule.key)
            FlatMessageAccessor.set(result, rule.key, converted)
        }

        // 3. Custom code rules
        val flatMap = if (definition.customCodeRules.isNotEmpty()) FlatMessageAccessor.flatten(result) else null

        for (rule in definition.customCodeRules) {
            val scriptResult = try {
                scriptExecutor.executeTemplate(rule.code, flatMap!!)
            } catch (e: Exception) {
                throw CustomValueTransformException("값 변환 커스텀 코드 실행 오류 (key=${rule.key}): ${e.message}", e)
            }

            val finalValue = if (rule.afterType != null) {
                convertType(scriptResult ?: "", rule.afterType, rule.key)
            } else {
                scriptResult
            }

            FlatMessageAccessor.set(result, rule.key, finalValue)
        }

        return result
    }

    private fun convertType(value: Any?, targetType: FieldType, key: String): Any? {
        if (value == null) return null
        return try {
            when (targetType) {
                FieldType.STRING -> value.toString()
                FieldType.INT -> value.toString().toInt()
                FieldType.DOUBLE -> value.toString().toDouble()
                FieldType.BOOLEAN -> value.toString().toBooleanStrict()
                else -> value
            }
        } catch (e: Exception) {
            throw CustomValueTransformException("타입 변환 실패 (key=$key, value=$value, targetType=$targetType): ${e.message}")
        }
    }
}
