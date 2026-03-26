package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.FieldType

enum class TransformRuleType { VALUE_REPLACE, TYPE_CONVERT, CUSTOM_CODE }

data class ValueReplaceRule(
    val key: String,
    val matchValue: String,
    val afterValue: String
)

data class TypeConvertRule(
    val key: String,
    val beforeType: FieldType,
    val afterType: FieldType
)

data class CustomCodeRule(
    val key: String,
    val code: String,         // JS expression using {$key} placeholders
    val afterType: FieldType? = null
)

data class Node2Definition(
    val valueReplaceRules: List<ValueReplaceRule> = emptyList(),
    val typeConvertRules: List<TypeConvertRule> = emptyList(),
    val customCodeRules: List<CustomCodeRule> = emptyList()
)
