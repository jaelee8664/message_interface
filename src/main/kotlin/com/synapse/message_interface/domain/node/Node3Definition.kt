package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.FieldType

enum class ListAddItemType { FIXED, FIELD_REF, EXPR }

/**
 * Describes a single item to append to a list field.
 * - FIXED: add a literal value (fixedValue + fixedType required)
 * - FIELD_REF: resolve value from the input data at fieldRef (dot-notation)
 */
data class ListAddItem(
    val type: ListAddItemType,
    val fixedValue: String? = null,      // FIXED: string representation of the value
    val fixedType: FieldType? = null,    // FIXED: STRING / INT / DOUBLE / BOOLEAN; null → null value
    val fieldRef: String? = null,        // FIELD_REF: dot-notation key into input data
    val expr: String? = null,            // EXPR: JS expression returning any value (primitive/object/array); {$key} refs supported
    val prepend: Boolean = false,        // true = insert at front of list, false = append at end
    val addCondition: String? = null,    // JS expression evaluated against flat outer DTO; null = always add
)

data class ItemFieldMapping(
    val newKey: String,     // output field name within each list element
    val beforeKey: String,  // input field name within each list element (dot-notation)
)

data class DtoMapping(
    val newKey: String,
    val beforeKey: String,              // dot-notation from input DTO, supports list index: items[0].id
    val filterCode: String? = null,     // JS expression for list filtering; outer DTO fields + Map item fields exposed as vars; primitive item exposed as 'item'
    val listAddItems: List<ListAddItem>? = null,  // items to append after filtering
    val itemMappings: List<ItemFieldMapping>? = null  // field-level remapping applied to every list element
)

data class Node3Definition(
    val mappings: List<DtoMapping>
)
