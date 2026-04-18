package com.synapse.message_interface.api.dto

import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowCondition
import com.synapse.message_interface.domain.WorkflowUnit

data class SaveWorkflowRequest(val unit: WorkflowUnit)

data class DeleteWorkflowRequest(val unitId: String)

data class RollbackRequest(val version: Int)

data class ValidateConditionRequest(
    val unitId: String? = null,
    val condition: WorkflowCondition,
    val protocol: ProtocolType? = null
)
