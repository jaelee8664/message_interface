package com.synapse.message_interface.config

import com.synapse.message_interface.domain.WorkflowTree
import org.springframework.data.annotation.Id
import org.springframework.data.mongodb.core.mapping.Document
import java.time.Instant

@Document(collection = "workflow_tree")
data class MongoWorkflowDocument(
    @Id val id: String = "singleton",
    val tree: WorkflowTree,
    val updatedAt: Instant = Instant.now()
)
