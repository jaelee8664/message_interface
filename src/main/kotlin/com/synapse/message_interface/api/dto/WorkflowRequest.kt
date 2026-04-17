package com.synapse.message_interface.api.dto

import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowCondition
import com.synapse.message_interface.domain.WorkflowUnit

data class SaveWorkflowRequest(
    val modifiedBy: String,
    val password: String,
    val unit: WorkflowUnit
)

data class DeleteWorkflowRequest(
    val modifiedBy: String,
    val password: String,
    val unitId: String
)

data class RollbackRequest(
    val modifiedBy: String,
    val password: String,
    val version: Int
)

data class ValidateConditionRequest(
    val unitId: String? = null,
    val condition: WorkflowCondition,
    val protocol: ProtocolType? = null
)
