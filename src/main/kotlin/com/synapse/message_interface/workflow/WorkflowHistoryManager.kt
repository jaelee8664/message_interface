package com.synapse.message_interface.workflow

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.WorkflowUnit
import jakarta.annotation.PostConstruct
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.data.annotation.Id
import org.springframework.data.domain.Sort
import org.springframework.data.mongodb.core.ReactiveMongoTemplate
import org.springframework.data.mongodb.core.index.Index
import org.springframework.data.mongodb.core.mapping.Document
import org.springframework.data.mongodb.core.query.Criteria
import org.springframework.data.mongodb.core.query.Query
import org.springframework.stereotype.Component
import java.time.Instant

@Document(collection = "workflow_history")
data class WorkflowHistoryMongoDocument(
    @Id val id: String = org.bson.types.ObjectId.get().toHexString(),
    val version: Int,
    val modifiedBy: String,
    val modifiedAt: Instant,
    val units: List<WorkflowUnitEmbedded>
)

data class WorkflowHistoryEntry(
    val id: String,
    val version: Int,
    val modifiedBy: String,
    val modifiedAt: Instant,
    val units: List<WorkflowUnit>
)

@Component
class WorkflowHistoryManager(
    private val template: ReactiveMongoTemplate,
    private val referenceConfigService: ReferenceConfigService
) {
    @Suppress("UNCHECKED_CAST")
    private val maxHistory: Int
        get() {
            val history = referenceConfigService.getConfig()["history"] as? Map<*, *>
            return (history?.get("maxVersions") as? Int) ?: 10
        }

    @PostConstruct
    fun init() {
        ensureIndexes()
    }

    private fun ensureIndexes() {
        val indexOps = template.indexOps("workflow_history")
        indexOps.ensureIndex(
            Index().on("version", Sort.Direction.ASC).named("idx_version")
        ).subscribe()
        indexOps.ensureIndex(
            Index().on("modifiedAt", Sort.Direction.DESC).named("idx_modifiedAt")
        ).subscribe()
    }

    suspend fun save(units: List<WorkflowUnit>, modifiedBy: String) {
        // 다음 버전 번호 계산
        val latestQuery = Query().with(Sort.by(Sort.Direction.DESC, "version")).limit(1)
        val latest = template.findOne(latestQuery, WorkflowHistoryMongoDocument::class.java).awaitFirstOrNull()
        val nextVersion = (latest?.version ?: 0) + 1

        template.insert(
            WorkflowHistoryMongoDocument(
                version = nextVersion,
                modifiedBy = modifiedBy,
                modifiedAt = Instant.now(),
                units = units.map(WorkflowUnitEmbedded::fromDomain)
            )
        ).awaitFirstOrNull()

        // maxHistory 초과분 삭제 (오래된 것부터)
        val max = maxHistory
        val total = template.count(Query(), WorkflowHistoryMongoDocument::class.java).awaitFirstOrNull() ?: 0L
        if (total > max) {
            val trimCount = (total - max).toInt()
            val oldestQuery = Query().with(Sort.by(Sort.Direction.ASC, "version")).limit(trimCount)
            val toDelete = template.find(oldestQuery, WorkflowHistoryMongoDocument::class.java)
                .collectList().awaitFirstOrNull() ?: emptyList()
            toDelete.forEach { template.remove(it).awaitFirstOrNull() }
        }
    }

    suspend fun listHistory(): List<WorkflowHistoryEntry> {
        val query = Query().with(Sort.by(Sort.Direction.DESC, "modifiedAt"))
        val docs = template.find(query, WorkflowHistoryMongoDocument::class.java)
            .collectList().awaitFirstOrNull() ?: emptyList()
        return docs.map { doc ->
            WorkflowHistoryEntry(
                id = doc.id,
                version = doc.version,
                modifiedBy = doc.modifiedBy,
                modifiedAt = doc.modifiedAt,
                units = doc.units.map { it.toDomain() }
            )
        }
    }

    suspend fun rollbackTo(version: Int): List<WorkflowUnit>? {
        val query = Query(Criteria.where("version").`is`(version))
        return template.findOne(query, WorkflowHistoryMongoDocument::class.java)
            .awaitFirstOrNull()
            ?.units
            ?.map { it.toDomain() }
    }
}
