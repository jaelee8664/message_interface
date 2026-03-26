package com.synapse.message_interface.domain

enum class ProtocolType {
    WEBSOCKET_SERVER, WEBSOCKET_CLIENT,
    GRPC_SERVER, GRPC_CLIENT,
    TCP_SERVER, TCP_CLIENT,
    KAFKA_CONSUMER,
    KAFKA_PUBLISHER,
    REST_SERVER
}
