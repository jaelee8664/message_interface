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

// List item code: {$el} for primitives, {$el.field} for map elements, {$outerKey} for outer fields
data class ListItemFieldCodeRule(
    val fieldKey: String,     // field name within element ("" for primitive lists)
    val code: String,
    val afterType: FieldType? = null
)

data class ListItemCodeRule(
    val listKey: String,      // dot-notation path to the list (e.g. "body.items")
    val fieldRules: List<ListItemFieldCodeRule> = emptyList()
)

data class Node2Definition(
    val valueReplaceRules: List<ValueReplaceRule> = emptyList(),
    val typeConvertRules: List<TypeConvertRule> = emptyList(),
    val customCodeRules: List<CustomCodeRule> = emptyList(),
    val listItemCodeRules: List<ListItemCodeRule> = emptyList(),
    val variableExtractions: List<VariableExtraction> = emptyList(),
)
