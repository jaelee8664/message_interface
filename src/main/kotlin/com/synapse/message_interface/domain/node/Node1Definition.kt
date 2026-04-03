package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.MessageFormat

data class CustomDtoDefinition(
    val name: String,
    val fields: List<FieldDefinition>
)

data class Node1Definition(
    val messageFormat: MessageFormat,
    val fields: List<FieldDefinition>,
    val customDtos: List<CustomDtoDefinition> = emptyList(),
)
