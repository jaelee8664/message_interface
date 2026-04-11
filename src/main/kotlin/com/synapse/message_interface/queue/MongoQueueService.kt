package com.synapse.message_interface.queue

import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.bson.Document
import org.slf4j.LoggerFactory
import org.springframework.data.domain.Sort
import org.springframework.data.mongodb.core.FindAndModifyOptions
import org.springframework.data.mongodb.core.ReactiveMongoTemplate
import org.springframework.data.mongodb.core.index.CompoundIndexDefinition
import org.springframework.data.mongodb.core.index.Index
import org.springframework.data.mongodb.core.query.Criteria
import org.springframework.data.mongodb.core.query.Query
import org.springframework.data.mongodb.core.query.Update
import org.springframework.stereotype.Component
import com.synapse.message_interface.config.ReferenceConfigService
import java.time.Instant
import java.util.UUID

@Component
class MongoQueueService(
    private val template: ReactiveMongoTemplate,
    private val referenceConfigService: ReferenceConfigService
) {

    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 스테일 락 기준: 60초 이상 PROCESSING 상태이면 복구
    private val staleLockThresholdMs = 60_000L

    @PostConstruct
    fun init() {
        ensureIndexes()
        startStaleLockRecovery()
        startCleanupJob()
    }

    @PreDestroy
    fun destroy() {
        scope.cancel()
    }

    // ── 인덱스 ──────────────────────────────────────────────────────────────────

    private fun ensureIndexes() {
        val indexOps = template.indexOps(MongoQueueMessage::class.java)
        // 발행 dedup용 unique 인덱스
        indexOps.ensureIndex(
            Index().on("messageId", Sort.Direction.ASC).unique().named("idx_messageId_unique")
        ).subscribe()
        // 소비 폴링용 복합 인덱스
        indexOps.ensureIndex(
            CompoundIndexDefinition(
                Document("queueName", 1).append("status", 1).append("publishedAt", 1)
            ).named("idx_queue_status_published")
        ).subscribe()
        // DONE/FAILED 정리용 복합 인덱스
        indexOps.ensureIndex(
            CompoundIndexDefinition(
                Document("status", 1).append("processedAt", 1)
            ).named("idx_status_processedAt")
        ).subscribe()
    }

    // ── 발행 (NODE4) ─────────────────────────────────────────────────────────────

    /**
     * MongoDB 큐에 메세지 발행.
     * [messageId]가 이미 존재하면 중복 발행으로 간주하고 무시 (exactly-once 보장).
     */
    suspend fun publish(queueName: String, payload: ByteArray, messageId: String = UUID.randomUUID().toString()) {
        val message = MongoQueueMessage(
            messageId = messageId,
            queueName = queueName,
            payload = payload,
            publishedAt = Instant.now()
        )
        try {
            template.insert(message).awaitFirstOrNull()
            log.debug("[MongoQueue] 발행: queueName=$queueName, messageId=$messageId")
        } catch (e: Exception) {
            if (isDuplicateKeyException(e)) {
                log.debug("[MongoQueue] 중복 발행 무시: messageId=$messageId")
            } else {
                throw e
            }
        }
    }

    private fun isDuplicateKeyException(e: Throwable): Boolean {
        val msg = e.message ?: return false
        return msg.contains("E11000") || e.javaClass.simpleName.contains("DuplicateKey")
    }

    // ── 소비 (NODE0) ─────────────────────────────────────────────────────────────

    /**
     * 가장 오래된 PENDING 메세지를 원자적으로 PROCESSING 상태로 전환하여 반환.
     * 큐가 비어 있으면 null 반환.
     */
    suspend fun dequeue(queueName: String, lockId: String): MongoQueueMessage? {
        val query = Query(
            Criteria.where("queueName").`is`(queueName)
                .and("status").`is`(QueueMessageStatus.PENDING)
        ).with(Sort.by(Sort.Direction.ASC, "publishedAt"))

        val update = Update()
            .set("status", QueueMessageStatus.PROCESSING)
            .set("lockId", lockId)
            .set("lockAt", Instant.now())

        return template.findAndModify(
            query, update,
            FindAndModifyOptions.options().returnNew(true),
            MongoQueueMessage::class.java
        ).awaitFirstOrNull()
    }

    /** 처리 완료 → DONE */
    suspend fun markDone(message: MongoQueueMessage) {
        val query = Query(
            Criteria.where("_id").`is`(message.id).and("lockId").`is`(message.lockId)
        )
        val update = Update()
            .set("status", QueueMessageStatus.DONE)
            .set("processedAt", Instant.now())
            .unset("lockId")
            .unset("lockAt")
        template.updateFirst(query, update, MongoQueueMessage::class.java).awaitFirstOrNull()
    }

    /** 처리 실패 → PENDING 복구 (재시도 카운트 증가) */
    suspend fun resetPending(message: MongoQueueMessage, incrementRetry: Boolean = false) {
        val query = Query(
            Criteria.where("_id").`is`(message.id).and("lockId").`is`(message.lockId)
        )
        val update = Update()
            .set("status", QueueMessageStatus.PENDING)
            .unset("lockId")
            .unset("lockAt")
        if (incrementRetry) update.inc("retryCount", 1)
        template.updateFirst(query, update, MongoQueueMessage::class.java).awaitFirstOrNull()
    }

    /** 재시도 한계 초과 → FAILED */
    suspend fun markFailed(message: MongoQueueMessage) {
        val query = Query(
            Criteria.where("_id").`is`(message.id).and("lockId").`is`(message.lockId)
        )
        val update = Update()
            .set("status", QueueMessageStatus.FAILED)
            .set("processedAt", Instant.now())
            .inc("retryCount", 1)
            .unset("lockId")
            .unset("lockAt")
        template.updateFirst(query, update, MongoQueueMessage::class.java).awaitFirstOrNull()
        log.warn("[MongoQueue] FAILED 처리: messageId=${message.messageId}")
    }

    // ── Config helpers ────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun mongoQueueConfig(): Map<*, *>? =
        referenceConfigService.getConfig()["mongoQueue"] as? Map<*, *>

    private fun getDoneRetentionMs(): Long =
        ((mongoQueueConfig()?.get("doneRetentionHours") as? Number)?.toLong() ?: 24L) * 3_600_000L

    private fun getFailedRetentionMs(): Long =
        ((mongoQueueConfig()?.get("failedRetentionDays") as? Number)?.toLong() ?: 7L) * 86_400_000L

    private fun getCleanupIntervalMs(): Long =
        ((mongoQueueConfig()?.get("cleanupIntervalMinutes") as? Number)?.toLong() ?: 60L) * 60_000L

    // ── DONE/FAILED 정리 ──────────────────────────────────────────────────────

    private fun startCleanupJob() {
        scope.launch {
            while (true) {
                delay(getCleanupIntervalMs())
                try {
                    runCleanup()
                } catch (e: Exception) {
                    log.error("[MongoQueue] 정리 오류: ${e.message}", e)
                }
            }
        }
    }

    private suspend fun runCleanup() {
        val doneThreshold = Instant.now().minusMillis(getDoneRetentionMs())
        val failedThreshold = Instant.now().minusMillis(getFailedRetentionMs())

        val doneQuery = Query(
            Criteria.where("status").`is`(QueueMessageStatus.DONE)
                .and("processedAt").lt(doneThreshold)
        )
        val doneResult = template.remove(doneQuery, MongoQueueMessage::class.java).awaitFirstOrNull()
        val doneCount = doneResult?.deletedCount ?: 0
        if (doneCount > 0) log.info("[MongoQueue] DONE 메세지 정리: ${doneCount}건 삭제")

        val failedQuery = Query(
            Criteria.where("status").`is`(QueueMessageStatus.FAILED)
                .and("processedAt").lt(failedThreshold)
        )
        val failedResult = template.remove(failedQuery, MongoQueueMessage::class.java).awaitFirstOrNull()
        val failedCount = failedResult?.deletedCount ?: 0
        if (failedCount > 0) log.info("[MongoQueue] FAILED 메세지 정리: ${failedCount}건 삭제")
    }

    // ── 스테일 락 복구 ────────────────────────────────────────────────────────────

    private fun startStaleLockRecovery() {
        scope.launch {
            while (true) {
                delay(staleLockThresholdMs / 2)
                try {
                    val threshold = Instant.now().minusMillis(staleLockThresholdMs)
                    val query = Query(
                        Criteria.where("status").`is`(QueueMessageStatus.PROCESSING)
                            .and("lockAt").lt(threshold)
                    )
                    val update = Update()
                        .set("status", QueueMessageStatus.PENDING)
                        .unset("lockId")
                        .unset("lockAt")
                    val result = template.updateMulti(query, update, MongoQueueMessage::class.java)
                        .awaitFirstOrNull()
                    val count = result?.modifiedCount ?: 0
                    if (count > 0) log.warn("[MongoQueue] 스테일 락 복구: ${count}건 → PENDING")
                } catch (e: Exception) {
                    log.error("[MongoQueue] 스테일 락 복구 오류: ${e.message}", e)
                }
            }
        }
    }
}
