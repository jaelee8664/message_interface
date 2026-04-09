package com.synapse.message_interface.queue

import org.springframework.data.annotation.Id
import org.springframework.data.mongodb.core.mapping.Document
import java.time.Instant

enum class QueueMessageStatus { PENDING, PROCESSING, DONE, FAILED }

@Document(collection = "message_queue")
data class MongoQueueMessage(
    @Id val id: String? = null,
    val messageId: String,           // 발행 측 dedup 키 (unique index)
    val queueName: String,
    val payload: ByteArray,
    val status: QueueMessageStatus = QueueMessageStatus.PENDING,
    val publishedAt: Instant = Instant.now(),
    val processedAt: Instant? = null,
    val lockId: String? = null,      // 소비 중인 요청의 트랜잭션 ID (스테일 감지용)
    val lockAt: Instant? = null,     // 락 획득 시각
    val retryCount: Int = 0
)
