package com.synapse.message_interface.domain

/**
 * Protobuf 중첩 메시지 정의.
 * gRPC DynamicMessage 스키마에서 중첩 MESSAGE 타입을 지원하기 위해 사용.
 * Node1Definition / Node4Definition 의 protoMessages 에 저장된다.
 */
data class ProtoMessageDef(
    val name: String,
    val fields: List<ProtoFieldDef>
)
