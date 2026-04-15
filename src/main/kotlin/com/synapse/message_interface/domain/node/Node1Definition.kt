package com.synapse.message_interface.domain.node

import com.synapse.message_interface.domain.FieldDefinition
import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtoFieldDef
import com.synapse.message_interface.domain.ProtoMessageDef

data class CustomDtoDefinition(
    val name: String,
    val fields: List<FieldDefinition>
)

data class Node1Definition(
    val messageFormat: MessageFormat,
    val fields: List<FieldDefinition>,
    val customDtos: List<CustomDtoDefinition> = emptyList(),
    // gRPC 전용: proto 스키마 (messageFormat == PROTOBUF 일 때 사용)
    // 이 목록에서 fields 가 자동 파생되어 기존 파이프라인 검증 로직 재사용
    val protoSchema: List<ProtoFieldDef>? = null,
    val protoMessages: List<ProtoMessageDef>? = null,   // 중첩 MESSAGE 타입 정의
)
