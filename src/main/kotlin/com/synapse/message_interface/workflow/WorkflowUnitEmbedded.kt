package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.WorkflowCondition
import com.synapse.message_interface.domain.WorkflowEdge
import com.synapse.message_interface.domain.WorkflowNode
import com.synapse.message_interface.domain.WorkflowUnit
import org.springframework.data.mongodb.core.mapping.Field

/**
 * Embedded shape for `workflow_history.units[]`.
 *
 * History stores the identifier as `id` (not Mongo `_id`) to keep snapshots stable and portable.
 */
data class WorkflowUnitEmbedded(
    @field:Field("id")
    val id: String,
    val name: String,
    val condition: WorkflowCondition,
    val nodes: List<WorkflowNode>,
    val edges: List<WorkflowEdge>
) {
    fun toDomain(): WorkflowUnit = WorkflowUnit(
        id = id,
        name = name,
        condition = condition,
        nodes = nodes,
        edges = edges
    )

    companion object {
        fun fromDomain(unit: WorkflowUnit): WorkflowUnitEmbedded = WorkflowUnitEmbedded(
            id = unit.id,
            name = unit.name,
            condition = unit.condition,
            nodes = unit.nodes,
            edges = unit.edges
        )
    }
}

