package com.synapse.message_interface.reception

import com.google.protobuf.ByteString
import com.google.protobuf.DescriptorProtos
import com.google.protobuf.Descriptors
import com.google.protobuf.DynamicMessage
import com.synapse.message_interface.domain.ProtoFieldDef
import com.synapse.message_interface.domain.ProtoFieldLabel
import com.synapse.message_interface.domain.ProtoFieldType
import com.synapse.message_interface.domain.ProtoMessageDef

/**
 * ProtoFieldDef 목록 ↔ Protobuf Descriptor / DynamicMessage / Map 변환 유틸.
 *
 * ■ 설계 원칙
 *   - .proto 파일 컴파일 없이 런타임에 Descriptor 를 동적 생성한다.
 *   - gRPC bidi stream 마샬러(DynamicMessageMarshaller)와 Node4 직렬화 모두 이 유틸을 사용한다.
 *   - 중첩 메시지는 [nestedMessages] 로 전달하며, 동일 FileDescriptor 에 함께 빌드된다.
 *   - 루트 메시지 필드에서 [ProtoFieldDef.messageTypeName] 이 non-null 이면 MESSAGE 타입으로 처리.
 */
object DynamicProtoUtil {

    // ── Descriptor 빌드 ────────────────────────────────────────────────────────

    /**
     * [fields] 목록에서 proto3 Descriptor 를 동적 생성한다.
     * [nestedMessages] 에 중첩 메시지 정의를 전달하면 동일 FileDescriptor 에 함께 등록된다.
     * [messageName] 은 동일 FileDescriptor 내에서 고유해야 한다.
     */
    fun buildDescriptor(
        messageName: String,
        fields: List<ProtoFieldDef>,
        nestedMessages: List<ProtoMessageDef> = emptyList(),
    ): Descriptors.Descriptor {
        require(fields.isNotEmpty()) { "proto 스키마 필드가 비어 있습니다: $messageName" }

        val fileProtoBuilder = DescriptorProtos.FileDescriptorProto.newBuilder()
            .setName("$messageName.proto")
            .setSyntax("proto3")

        // 중첩 메시지 타입을 먼저 추가 (루트보다 앞서 정의되어야 참조 가능)
        for (nested in nestedMessages) {
            fileProtoBuilder.addMessageType(buildMessageDescriptorProto(nested.name, nested.fields))
        }

        // 루트 메시지 추가
        fileProtoBuilder.addMessageType(buildMessageDescriptorProto(messageName, fields))

        val fileDescriptor = Descriptors.FileDescriptor.buildFrom(fileProtoBuilder.build(), emptyArray())
        return fileDescriptor.findMessageTypeByName(messageName)
            ?: error("Descriptor 생성 후 메시지를 찾지 못했습니다: $messageName")
    }

    private fun buildMessageDescriptorProto(
        name: String,
        fields: List<ProtoFieldDef>,
    ): DescriptorProtos.DescriptorProto =
        DescriptorProtos.DescriptorProto.newBuilder()
            .setName(name)
            .apply {
                fields.sortedBy { it.number }.forEach { f ->
                    val fieldBuilder = DescriptorProtos.FieldDescriptorProto.newBuilder()
                        .setNumber(f.number)
                        .setName(f.name)
                        .setJsonName(f.name)
                        .setLabel(f.label.toProtoLabel())

                    if (f.messageTypeName != null) {
                        // MESSAGE 타입: .TypeName 형태의 fully-qualified 참조
                        fieldBuilder
                            .setType(DescriptorProtos.FieldDescriptorProto.Type.TYPE_MESSAGE)
                            .setTypeName(".${f.messageTypeName}")
                    } else {
                        fieldBuilder.setType(f.type.toProtoType())
                    }

                    addField(fieldBuilder.build())
                }
            }
            .build()

    // ── DynamicMessage → Map ──────────────────────────────────────────────────

    /**
     * DynamicMessage 의 설정된 필드를 Map<String, Any?> 로 변환.
     * proto3 에서 기본값 필드(0, false, "")는 allFields 에 포함되지 않으므로 Map 에도 없다.
     * 중첩 MESSAGE 필드는 재귀적으로 Map 으로 변환된다.
     */
    fun DynamicMessage.toMap(): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>()
        for ((fieldDesc, value) in allFields) {
            result[fieldDesc.name] = when {
                fieldDesc.isRepeated -> (value as List<*>).map { it.toKotlinValue() }
                else -> value.toKotlinValue()
            }
        }
        return result
    }

    // ── Map → DynamicMessage ──────────────────────────────────────────────────

    /**
     * Map<String, Any?> 을 [descriptor] 에 맞게 DynamicMessage 로 변환.
     * Map 에 없는 필드는 proto3 기본값으로 처리된다 (builder 에 세팅하지 않음).
     * MESSAGE 타입 필드는 중첩 Map 을 재귀적으로 DynamicMessage 로 변환한다.
     */
    fun Map<String, Any?>.toDynamicMessage(descriptor: Descriptors.Descriptor): DynamicMessage {
        val builder = DynamicMessage.newBuilder(descriptor)
        for (fieldDesc in descriptor.fields) {
            val value = this[fieldDesc.name] ?: continue
            when {
                fieldDesc.isRepeated -> {
                    val list = (value as? List<*>) ?: listOf(value)
                    list.forEach { item ->
                        if (item != null) {
                            builder.addRepeatedField(fieldDesc, item.fromKotlinValue(fieldDesc))
                        }
                    }
                }
                else -> builder.setField(fieldDesc, value.fromKotlinValue(fieldDesc))
            }
        }
        return builder.build()
    }

    // ── 내부 변환 헬퍼 ────────────────────────────────────────────────────────

    private fun Any?.toKotlinValue(): Any? = when (this) {
        is DynamicMessage -> toMap()   // 중첩 메시지: 재귀 변환
        is ByteString -> toByteArray()
        else -> this
    }

    private fun Any.fromKotlinValue(fieldDesc: Descriptors.FieldDescriptor): Any =
        when (fieldDesc.type) {
            Descriptors.FieldDescriptor.Type.MESSAGE -> when (this) {
                is Map<*, *> -> @Suppress("UNCHECKED_CAST")
                    (this as Map<String, Any?>).toDynamicMessage(fieldDesc.messageType)
                is DynamicMessage -> this
                else -> this
            }

            Descriptors.FieldDescriptor.Type.STRING ->
                this.toString()

            Descriptors.FieldDescriptor.Type.INT32,
            Descriptors.FieldDescriptor.Type.SINT32,
            Descriptors.FieldDescriptor.Type.SFIXED32 ->
                when (this) { is Number -> toInt(); else -> toString().toIntOrNull() ?: 0 }

            Descriptors.FieldDescriptor.Type.INT64,
            Descriptors.FieldDescriptor.Type.SINT64,
            Descriptors.FieldDescriptor.Type.SFIXED64 ->
                when (this) { is Number -> toLong(); else -> toString().toLongOrNull() ?: 0L }

            Descriptors.FieldDescriptor.Type.UINT32,
            Descriptors.FieldDescriptor.Type.FIXED32 ->
                when (this) { is Number -> toInt(); else -> toString().toIntOrNull() ?: 0 }

            Descriptors.FieldDescriptor.Type.UINT64,
            Descriptors.FieldDescriptor.Type.FIXED64 ->
                when (this) { is Number -> toLong(); else -> toString().toLongOrNull() ?: 0L }

            Descriptors.FieldDescriptor.Type.FLOAT ->
                when (this) { is Number -> toFloat(); else -> toString().toFloatOrNull() ?: 0f }

            Descriptors.FieldDescriptor.Type.DOUBLE ->
                when (this) { is Number -> toDouble(); else -> toString().toDoubleOrNull() ?: 0.0 }

            Descriptors.FieldDescriptor.Type.BOOL ->
                when (this) {
                    is Boolean -> this
                    is Number -> toInt() != 0
                    else -> toString().toBooleanStrictOrNull() ?: false
                }

            Descriptors.FieldDescriptor.Type.BYTES ->
                when (this) {
                    is ByteArray -> ByteString.copyFrom(this)
                    is ByteString -> this
                    else -> ByteString.copyFromUtf8(toString())
                }

            else -> this
        }

    // ── ProtoFieldDef enum → Protobuf enum ───────────────────────────────────

    private fun ProtoFieldType.toProtoType(): DescriptorProtos.FieldDescriptorProto.Type =
        when (this) {
            ProtoFieldType.STRING  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_STRING
            ProtoFieldType.INT32   -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_INT32
            ProtoFieldType.INT64   -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_INT64
            ProtoFieldType.FLOAT   -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_FLOAT
            ProtoFieldType.DOUBLE  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_DOUBLE
            ProtoFieldType.BOOL    -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_BOOL
            ProtoFieldType.BYTES   -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_BYTES
            ProtoFieldType.UINT32  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_UINT32
            ProtoFieldType.UINT64  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_UINT64
            ProtoFieldType.SINT32  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_SINT32
            ProtoFieldType.SINT64  -> DescriptorProtos.FieldDescriptorProto.Type.TYPE_SINT64
        }

    private fun ProtoFieldLabel.toProtoLabel(): DescriptorProtos.FieldDescriptorProto.Label =
        when (this) {
            ProtoFieldLabel.OPTIONAL -> DescriptorProtos.FieldDescriptorProto.Label.LABEL_OPTIONAL
            ProtoFieldLabel.REPEATED -> DescriptorProtos.FieldDescriptorProto.Label.LABEL_REPEATED
        }
}
