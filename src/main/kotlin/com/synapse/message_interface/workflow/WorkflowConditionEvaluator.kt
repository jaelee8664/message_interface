package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.ConditionType
import com.synapse.message_interface.domain.FieldOperator
import com.synapse.message_interface.domain.KeyOperator
import com.synapse.message_interface.domain.LogicalOp
import com.synapse.message_interface.domain.WorkflowCondition
import org.springframework.http.server.PathContainer
import org.springframework.stereotype.Component
import org.springframework.web.util.pattern.PathPattern
import org.springframework.web.util.pattern.PathPatternParser
import java.util.concurrent.ConcurrentHashMap

@Component
class WorkflowConditionEvaluator {
    private val patternParser = PathPatternParser()
    private val patternCache = ConcurrentHashMap<String, PathPattern>()

    /**
     * Evaluate whether the given message context matches a condition.
     * Supports composite AND/OR conditions recursively.
     *
     * @param condition the WorkflowCondition to check
     * @param endpoint the URI endpoint of the incoming request (nullable if not REST)
     * @param messageFields flat map of dot-notation field keys to string values
     */
    fun matches(
        condition: WorkflowCondition,
        endpoint: String?,
        messageFields: Map<String, String?>
    ): Boolean {
        // Composite condition: AND / OR
        if (condition.logicalOp != null && !condition.subConditions.isNullOrEmpty()) {
            return when (condition.logicalOp) {
                LogicalOp.AND -> condition.subConditions.all { matches(it, endpoint, messageFields) }
                LogicalOp.OR  -> condition.subConditions.any { matches(it, endpoint, messageFields) }
            }
        }

        // Leaf condition
        return when (condition.type) {
            ConditionType.ENDPOINT -> {
                if (endpoint == null) false
                else {
                    val raw = condition.endpointPattern ?: return false
                    val pattern = patternCache.getOrPut(raw) { patternParser.parse(raw) }
                    pattern.matches(PathContainer.parsePath(endpoint))
                }
            }
            ConditionType.FIELD_VALUE -> {
                val key = condition.fieldKey ?: return false
                val actual = messageFields[key]
                when (condition.fieldOperator ?: FieldOperator.EQ) {
                    FieldOperator.EQ  -> actual == condition.fieldValue
                    FieldOperator.NEQ -> actual != condition.fieldValue
                }
            }
            ConditionType.CONTAINS_KEY -> {
                val key = condition.containsKey ?: return false
                val exists = messageFields.containsKey(key)
                when (condition.containsKeyOperator ?: KeyOperator.EXISTS) {
                    KeyOperator.EXISTS     -> exists
                    KeyOperator.NOT_EXISTS -> !exists
                }
            }
            null -> false
        }
    }
}
