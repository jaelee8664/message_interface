package com.synapse.message_interface.domain

data class WorkflowCondition(
    // ── Leaf condition fields (used when logicalOp is null) ──────────────────
    val type: ConditionType? = null,
    val endpointPattern: String? = null,   // for ENDPOINT type
    val fieldKey: String? = null,          // for FIELD_VALUE type
    val fieldValue: String? = null,        // for FIELD_VALUE type
    val containsKey: String? = null,       // for CONTAINS_KEY type

    // ── Composite condition fields (used when type is null) ──────────────────
    val logicalOp: LogicalOp? = null,              // AND / OR
    val subConditions: List<WorkflowCondition>? = null,

    // ── Display ──────────────────────────────────────────────────────────────
    val rawExpression: String? = null      // human-readable string for display
)

enum class ConditionType {
    ENDPOINT,       // URI endpoint pattern match
    FIELD_VALUE,    // specific field has specific value
    CONTAINS_KEY    // message contains specific key
}

enum class LogicalOp {
    AND, OR
}
