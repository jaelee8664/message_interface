package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtocolType

data class Node4Definition(
    val messageFormat: MessageFormat,
    val protocol: ProtocolType,
    val targetHost: String? = null,
    val targetPort: Int? = null,
    val targetPath: String? = null,
    val targetTopic: String? = null,        // for Kafka
    val bootstrapServers: String? = null,   // for Kafka (publisher)
    val retryCount: Int = 0,            // 재시도 횟수 (0 = 재시도 없음)
    val retryDelaySeconds: Int = 0,     // 재시도 간격 (0 = 즉시)
    val timeoutMs: Long = 5000L,        // 타임아웃 (밀리초)
    val reconnectEnabled: Boolean = true,
    val reconnectDelaySeconds: Int = 5,
)
