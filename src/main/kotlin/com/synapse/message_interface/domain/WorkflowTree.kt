package com.synapse.message_interface.domain

data class WorkflowTree(
    val units: List<WorkflowUnit> = emptyList()
)
