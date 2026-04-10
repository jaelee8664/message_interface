package com.synapse.message_interface.domain

import org.springframework.data.mongodb.core.mapping.Document
import org.springframework.data.mongodb.core.mapping.Field
import org.springframework.data.annotation.Id

@Document(collection = "workflow_units")
data class WorkflowUnit(
    @Id val id: String,
    val name: String,
    val condition: WorkflowCondition,
    val nodes: List<WorkflowNode>,
    val edges: List<WorkflowEdge>
)
