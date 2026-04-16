package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.ConditionType
import com.synapse.message_interface.domain.FieldOperator
import com.synapse.message_interface.domain.KeyOperator
import com.synapse.message_interface.domain.LogicalOp
import com.synapse.message_interface.domain.WorkflowCondition
import org.springframework.stereotype.Component

data class ConditionConflict(
    val existingConditionExpression: String,
    val newConditionExpression: String,
    val reason: String
)

@Component
class WorkflowConditionValidator {

    /**
     * Check if the new condition intersects with any existing conditions.
     * Returns list of conflicts (empty = no conflict).
     * Supports composite AND/OR conditions.
     */
    fun validateNoIntersection(
        newCondition: WorkflowCondition,
        existingConditions: List<WorkflowCondition>
    ): List<ConditionConflict> {
        val conflicts = mutableListOf<ConditionConflict>()
        for (existing in existingConditions) {
            val conflict = checkIntersection(newCondition, existing)
            if (conflict != null) conflicts.add(conflict)
        }
        return conflicts
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    private fun checkIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? {
        // Both are leaf conditions
        if (a.logicalOp == null && b.logicalOp == null) {
            if (a.type == b.type) return checkLeafIntersection(a, b)
            return null // different types never intersect on their own dimension
        }

        // OR: intersects if ANY sub-condition intersects with the other side
        if (a.logicalOp == LogicalOp.OR) {
            return a.subConditions?.firstNotNullOfOrNull { checkIntersection(it, b) }
        }
        if (b.logicalOp == LogicalOp.OR) {
            return b.subConditions?.firstNotNullOfOrNull { checkIntersection(a, it) }
        }

        // AND vs AND
        if (a.logicalOp == LogicalOp.AND && b.logicalOp == LogicalOp.AND) {
            return checkAndAndIntersection(a, b)
        }

        // AND vs leaf (or leaf vs AND)
        val (andCond, leafCond) = if (a.logicalOp == LogicalOp.AND) Pair(a, b) else Pair(b, a)
        return checkAndLeafIntersection(andCond, leafCond)
    }

    /**
     * AND condition vs leaf condition.
     * The AND intersects with a leaf if the AND has sub-conditions of the same type
     * as the leaf AND all of them intersect with the leaf.
     * (Adding an AND restricts scope; it only conflicts when the type-specific parts conflict.)
     */
    private fun checkAndLeafIntersection(
        andCond: WorkflowCondition,
        leafCond: WorkflowCondition
    ): ConditionConflict? {
        val sameTypeSubs = andCond.subConditions?.filter { it.type == leafCond.type } ?: emptyList()
        if (sameTypeSubs.isEmpty()) return null // no sub-condition of same type → AND adds different dimension, coexists
        val allIntersect = sameTypeSubs.all { checkLeafIntersection(it, leafCond) != null }
        if (!allIntersect) return null
        return ConditionConflict(
            andCond.rawExpression ?: exprOf(andCond),
            leafCond.rawExpression ?: exprOf(leafCond),
            "AND 조건의 ${leafCond.type} 부분이 기존 조건과 교집합을 가집니다."
        )
    }

    /**
     * AND vs AND intersection.
     * Two AND conditions intersect only when, for every type present in both,
     * the sub-conditions of that type intersect.
     * If any shared type does NOT conflict, it's impossible for the same message to match both → no conflict.
     */
    private fun checkAndAndIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? {
        val aByType = a.subConditions?.groupBy { it.type } ?: emptyMap()
        val bByType = b.subConditions?.groupBy { it.type } ?: emptyMap()
        val commonTypes = aByType.keys.intersect(bByType.keys)

        if (commonTypes.isEmpty()) return null // no shared type → can't be definitively determined, assume safe

        for (type in commonTypes) {
            val aSubs = aByType[type] ?: continue
            val bSubs = bByType[type] ?: continue
            // For this type, check if any pair of (aSub, bSub) intersects
            val anyPairIntersects = aSubs.any { as_ -> bSubs.any { bs -> checkLeafIntersection(as_, bs) != null } }
            if (!anyPairIntersects) return null // this type has no conflict → AND conditions can coexist
        }

        return ConditionConflict(
            a.rawExpression ?: exprOf(a),
            b.rawExpression ?: exprOf(b),
            "AND 복합 조건 간 교집합이 감지되었습니다."
        )
    }

    // ── Leaf checkers (same as before) ────────────────────────────────────────

    private fun checkLeafIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? =
        when (a.type) {
            ConditionType.ENDPOINT     -> checkEndpointIntersection(a, b)
            ConditionType.FIELD_VALUE  -> checkFieldValueIntersection(a, b)
            ConditionType.CONTAINS_KEY -> checkContainsKeyIntersection(a, b)
            null -> null
        }

    private fun checkEndpointIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? {
        val patA = a.endpointPattern ?: return null
        val patB = b.endpointPattern ?: return null
        if (patA == patB) {
            return ConditionConflict(patA, patB, "동일한 endpoint 패턴입니다.")
        }
        val normalizedA = patA.replace(Regex("\\{[^}]+}"), "{*}")
        val normalizedB = patB.replace(Regex("\\{[^}]+}"), "{*}")
        if (normalizedA == normalizedB) {
            return ConditionConflict(patA, patB, "경로 변수명만 다른 동일한 패턴입니다. 교집합이 발생합니다.")
        }
        return null
    }

    private fun checkFieldValueIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? {
        if (a.fieldKey != b.fieldKey) return null

        val aOp = a.fieldOperator ?: FieldOperator.EQ
        val bOp = b.fieldOperator ?: FieldOperator.EQ

        val intersects = when {
            // EQ vs EQ: 같은 값이면 교집합
            aOp == FieldOperator.EQ  && bOp == FieldOperator.EQ  -> a.fieldValue == b.fieldValue
            // EQ vs NEQ: 같은 값이면 상호 배타(교집합 없음), 다른 값이면 교집합
            aOp == FieldOperator.EQ  && bOp == FieldOperator.NEQ -> a.fieldValue != b.fieldValue
            aOp == FieldOperator.NEQ && bOp == FieldOperator.EQ  -> a.fieldValue != b.fieldValue
            // NEQ vs NEQ: 항상 교집합 (두 조건을 모두 만족하는 값이 반드시 존재)
            else -> true
        }

        if (!intersects) return null

        val aExpr = fieldExpr(a)
        val bExpr = fieldExpr(b)
        val reason = when {
            aOp == FieldOperator.NEQ && bOp == FieldOperator.NEQ ->
                "두 != 조건은 항상 교집합이 존재합니다."
            aOp != bOp ->
                "${a.fieldKey} 의 == 조건 값이 != 조건 값과 달라 교집합이 발생합니다."
            else -> "동일한 필드 값 조건입니다."
        }
        return ConditionConflict(aExpr, bExpr, reason)
    }

    private fun fieldExpr(c: WorkflowCondition): String {
        val op = if ((c.fieldOperator ?: FieldOperator.EQ) == FieldOperator.EQ) "==" else "!="
        return "${c.fieldKey} $op ${c.fieldValue}"
    }

    private fun checkContainsKeyIntersection(a: WorkflowCondition, b: WorkflowCondition): ConditionConflict? {
        if (a.containsKey != b.containsKey) return null

        val aOp = a.containsKeyOperator ?: KeyOperator.EXISTS
        val bOp = b.containsKeyOperator ?: KeyOperator.EXISTS

        // 같은 키, 같은 연산자 → 교집합
        // 같은 키, 다른 연산자 (EXISTS vs NOT_EXISTS) → 상호 배타, 교집합 없음
        if (aOp == bOp) {
            val expr = keyExpr(a)
            return ConditionConflict(expr, expr, "동일한 키 ${if (aOp == KeyOperator.EXISTS) "포함" else "미포함"} 조건입니다.")
        }
        return null
    }

    private fun keyExpr(c: WorkflowCondition): String {
        val op = if ((c.containsKeyOperator ?: KeyOperator.EXISTS) == KeyOperator.EXISTS) "containsKey" else "notContainsKey"
        return "$op(${c.containsKey})"
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun exprOf(c: WorkflowCondition): String = when {
        c.logicalOp != null -> {
            val op = if (c.logicalOp == LogicalOp.AND) " AND " else " OR "
            c.subConditions?.joinToString(op, "(", ")") { exprOf(it) } ?: ""
        }
        c.type == ConditionType.ENDPOINT     -> "endpoint == \"${c.endpointPattern}\""
        c.type == ConditionType.FIELD_VALUE  -> fieldExpr(c)
        c.type == ConditionType.CONTAINS_KEY -> keyExpr(c)
        else -> ""
    }
}
