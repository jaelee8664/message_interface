package com.synapse.message_interface.domain

data class WorkflowCondition(
    // ── Leaf condition fields (used when logicalOp is null) ──────────────────
    val type: ConditionType? = null,
    val endpointPattern: String? = null,           // for ENDPOINT type
    val fieldKey: String? = null,                  // for FIELD_VALUE type
    val fieldOperator: FieldOperator? = null,      // for FIELD_VALUE type (default EQ)
    val fieldValue: String? = null,                // for FIELD_VALUE type
    val containsKey: String? = null,               // for CONTAINS_KEY type
    val containsKeyOperator: KeyOperator? = null,  // for CONTAINS_KEY type (default EXISTS)

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

enum class FieldOperator {
    EQ,   // field == value
    NEQ   // field != value
}

enum class KeyOperator {
    EXISTS,     // message contains key
    NOT_EXISTS  // message does not contain key
}

enum class LogicalOp {
    AND, OR
}
