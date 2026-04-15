package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtoFieldDef
import com.synapse.message_interface.domain.ProtoMessageDef
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
    // MONGO_QUEUE_PUBLISHER 전용
    val mongoQueueName: String? = null,   // 발행할 큐 이름
    // XML 직렬화 전용: 출력 메시지의 루트 엘리먼트 이름 (null이면 루트 래핑 없음)
    val xmlRootElement: String? = null,
    // gRPC 전용 (GRPC_CLIENT: 대상 서비스/메서드 / GRPC_SERVER: 수신한 스트림에 응답)
    val grpcServiceName: String? = null,
    val grpcMethodName: String? = null,
    val protoSchema: List<ProtoFieldDef>? = null,       // 출력 메시지 proto 스키마
    val protoMessages: List<ProtoMessageDef>? = null,   // 중첩 MESSAGE 타입 정의
)
