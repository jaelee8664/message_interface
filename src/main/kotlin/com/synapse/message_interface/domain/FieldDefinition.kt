package com.synapse.message_interface.domain

enum class FieldType { STRING, INT, DOUBLE, BOOLEAN, LIST, MAP, CUSTOM }

data class FieldDefinition(
    val key: String,           // dot-notation e.g. "header.time"
    val type: FieldType,
    val customTypeName: String? = null,   // if type == CUSTOM, the custom DTO name
    val listItemType: FieldType? = null,  // if type == LIST, the element type
    val defaultValue: String? = null,     // null means use type default
    val nullable: Boolean = false,
    val mandatory: Boolean = true,
    val description: String,
)
