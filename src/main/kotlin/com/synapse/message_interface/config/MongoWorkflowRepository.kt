package com.synapse.message_interface.config

import org.springframework.data.mongodb.repository.ReactiveMongoRepository

interface MongoWorkflowRepository : ReactiveMongoRepository<MongoWorkflowDocument, String>
