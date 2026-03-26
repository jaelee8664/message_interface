package com.synapse.message_interface.domain

data class WorkflowUnit(
    val id: String,
    val name: String,
    val condition: WorkflowCondition,
    val nodes: List<WorkflowNode>,
    val edges: List<WorkflowEdge>
)
