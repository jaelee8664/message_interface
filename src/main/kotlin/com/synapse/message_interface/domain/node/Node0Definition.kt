package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.ProtocolType

data class Node0Definition(
    val protocol: ProtocolType,
    val host: String? = null,         // for client mode
    val port: Int? = null,
    val path: String? = null,         // for WebSocket/REST
    val topic: String? = null,              // for Kafka
    val groupId: String? = null,            // for Kafka consumer
    val bootstrapServers: String? = null,   // for Kafka (consumer)
    val pingEnabled: Boolean = false,
    val pingIntervalSeconds: Int = 30,
    val pongTimeoutSeconds: Int = 10,
    val reconnectEnabled: Boolean = true,
    val reconnectDelaySeconds: Int = 5,
    val tcpIdleTimeoutSeconds: Int? = null,  // TCP_SERVER 전용, null = reference.yaml 기본값 사용
    // MONGO_QUEUE_CONSUMER 전용
    val mongoQueueName: String? = null,   // 소비할 큐 이름
    val mongoQueueMaxRetries: Int = 3,    // 처리 실패 시 PENDING 복구 최대 횟수 (초과 시 FAILED)
)
