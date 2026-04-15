package com.synapse.message_interface.domain

/**
 * Protobuf 필드 타입. gRPC DynamicMessage 스키마 정의에 사용.
 */
enum class ProtoFieldType {
    STRING, INT32, INT64, FLOAT, DOUBLE, BOOL, BYTES,
    UINT32, UINT64, SINT32, SINT64
}

/**
 * Protobuf 필드 레이블.
 * proto3 기준 OPTIONAL / REPEATED 만 지원.
 */
enum class ProtoFieldLabel { OPTIONAL, REPEATED }

/**
 * Protobuf 단일 필드 정의.
 * [number] 는 .proto 필드 번호 (1-based, 동일 메시지 내 고유해야 함).
 * [messageTypeName] 이 non-null 이면 MESSAGE 타입 필드로, protoMessages 에서 해당 이름의 메시지를 참조한다.
 * MongoDB / JSON 직렬화 시 그대로 저장되어 재시작 후 DynamicMessage Descriptor 재구성에 사용.
 */
data class ProtoFieldDef(
    val number: Int,
    val name: String,
    val type: ProtoFieldType,
    val label: ProtoFieldLabel = ProtoFieldLabel.OPTIONAL,
    val messageTypeName: String? = null,   // non-null → MESSAGE 타입 (type 필드는 무시됨)
)
