package com.synapse.message_interface.config

import com.synapse.message_interface.domain.WorkflowUnit
import org.springframework.data.mongodb.repository.ReactiveMongoRepository

interface MongoWorkflowRepository : ReactiveMongoRepository<WorkflowUnit, String>
