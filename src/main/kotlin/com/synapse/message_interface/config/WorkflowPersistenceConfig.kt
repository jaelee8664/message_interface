package com.synapse.message_interface.config

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.domain.WorkflowTree
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.io.File
import java.time.Instant

@Configuration
class WorkflowPersistenceConfig(
    // Optional MongoDB repo — null if MongoDB is not configured
    @Autowired(required = false) private val mongoRepo: MongoWorkflowRepository? = null
) {
    private val log = LoggerFactory.getLogger(javaClass)

    companion object {
        const val WORKFLOW_FILE = "workflow.json"
    }

    @Bean
    fun workflowLoader(registry: WorkflowRegistry, objectMapper: ObjectMapper) = ApplicationRunner {
        // 1. Try MongoDB first
        var loaded = false
        if (mongoRepo != null) {
            runCatching {
                val doc = mongoRepo!!.findById("singleton").block()
                if (doc != null) {
                    registry.load(doc.tree)
                    log.info("[WorkflowPersistence] MongoDB에서 워크플로우 로드 완료 (${doc.tree.units.size}개 단위)")
                    loaded = true
                }
            }.onFailure {
                log.warn("[WorkflowPersistence] MongoDB 로드 실패, JSON 파일로 폴백: ${it.message}")
            }
        }

        // 2. Fallback to JSON file
        if (!loaded) {
            val file = File(WORKFLOW_FILE)
            if (file.exists()) {
                val tree = objectMapper.readValue(file, WorkflowTree::class.java)
                registry.load(tree)
                log.info("[WorkflowPersistence] workflow.json에서 로드 완료 (${tree.units.size}개 단위)")
            }
        }
    }

    fun save(tree: WorkflowTree, objectMapper: ObjectMapper) {
        // Always save to JSON file
        File(WORKFLOW_FILE).writeText(objectMapper.writeValueAsString(tree))
        log.debug("[WorkflowPersistence] workflow.json 저장 완료")

        // Also save to MongoDB if available
        if (mongoRepo != null) {
            runCatching {
                val doc = MongoWorkflowDocument(tree = tree, updatedAt = Instant.now())
                mongoRepo!!.save(doc).block()
                log.debug("[WorkflowPersistence] MongoDB 저장 완료")
            }.onFailure {
                log.warn("[WorkflowPersistence] MongoDB 저장 실패 (JSON은 정상 저장됨): ${it.message}")
            }
        }
    }
}
