package com.synapse.message_interface.config

import com.synapse.message_interface.domain.WorkflowTree
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.workflow.WorkflowRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.bson.Document
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.data.mongodb.core.ReactiveMongoTemplate
import org.springframework.data.mongodb.core.query.Criteria
import org.springframework.data.mongodb.core.query.Query

@Configuration
class WorkflowPersistenceConfig(
    private val mongoRepo: MongoWorkflowRepository,
    private val template: ReactiveMongoTemplate
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Bean
    @Order(1)
    fun workflowLoader(registry: WorkflowRegistry) = ApplicationRunner {
        runBlocking {
            var units = mongoRepo.findAll().collectList().awaitFirstOrNull() ?: emptyList()
            log.info("[WorkflowPersistence] MongoDB에서 워크플로우 로드 시도: ${units.size}개 단위 발견")
            if (units.isEmpty()) {
                val migrated = migrateFromLegacyTree()
                if (migrated.isNotEmpty()) {
                    mongoRepo.saveAll(migrated).collectList().awaitFirstOrNull()
                    log.info("[WorkflowPersistence] 레거시 workflow_tree → workflow_units 마이그레이션 완료 (${migrated.size}개 단위)")
                    units = migrated
                }
            }

            log.info("[WorkflowPersistence] MongoDB에서 워크플로우 로드 완료 (${units.size}개 단위)")
            registry.load(WorkflowTree(units))
        }
    }

    private suspend fun migrateFromLegacyTree(): List<WorkflowUnit> {
        return try {
            val raw = template.findOne(
                Query(Criteria.where("_id").`is`("singleton")),
                Document::class.java,
                "workflow_tree"
            ).awaitFirstOrNull() ?: return emptyList()

            val unitDocs = (raw["tree"] as? Document)?.get("units")
            val docs = when (unitDocs) {
                is List<*> -> unitDocs.filterIsInstance<Document>()
                else -> return emptyList()
            }

            docs.map { doc ->
                if (!doc.containsKey("_id") && doc.containsKey("id")) {
                    doc["_id"] = doc["id"]
                }
                template.converter.read(WorkflowUnit::class.java, doc)
            }
        } catch (e: Exception) {
            log.warn("[WorkflowPersistence] 레거시 마이그레이션 실패 (무시됨): ${e.message}")
            emptyList()
        }
    }

    suspend fun saveUnit(unit: WorkflowUnit) {
        mongoRepo.save(unit).awaitFirstOrNull()
        log.debug("[WorkflowPersistence] 유닛 저장: ${unit.id}")
    }

    suspend fun deleteUnit(unitId: String) {
        mongoRepo.deleteById(unitId).awaitFirstOrNull()
        log.debug("[WorkflowPersistence] 유닛 삭제: $unitId")
    }

    /** 롤백 전용: 전체 교체 */
    suspend fun replaceAll(units: List<WorkflowUnit>) {
        mongoRepo.deleteAll().awaitFirstOrNull()
        if (units.isNotEmpty()) mongoRepo.saveAll(units).collectList().awaitFirstOrNull()
        log.debug("[WorkflowPersistence] 전체 유닛 교체: ${units.size}개")
    }
}
