package com.synapse.message_interface.domain

enum class ProtocolType {
    WEBSOCKET_SERVER, WEBSOCKET_CLIENT,
    TCP_SERVER, TCP_CLIENT,
    KAFKA_CONSUMER,
    KAFKA_PUBLISHER,
    REST_SERVER,              // NODE0 전용: HTTP 서버로 요청 수신
    REST_CLIENT,              // NODE4 전용: HTTP 클라이언트로 외부에 요청 송신
    MONGO_QUEUE_CONSUMER,     // NODE0 전용: MongoDB 메세지 큐에서 소비
    MONGO_QUEUE_PUBLISHER,    // NODE4 전용: MongoDB 메세지 큐에 발행
}
