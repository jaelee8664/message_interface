package com.synapse.message_interface.domain.node

data class VariableExtraction(
    val fieldPath: String,     // dot-notation: "header.srcIp", "body.items[0].id"
    val variableName: String   // 저장할 이름: "SRC_IP"
)
