package com.synapse.message_interface.reception

import com.google.protobuf.Descriptors
import com.google.protobuf.DynamicMessage
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.reception.DynamicProtoUtil.toMap
import io.grpc.Grpc
import io.grpc.Metadata
import io.grpc.MethodDescriptor
import io.grpc.ServerCall
import io.grpc.ServerCallHandler
import io.grpc.ServiceDescriptor
import io.grpc.ServerServiceDefinition
import io.grpc.Status
import io.grpc.stub.StreamObserver
import java.net.InetSocketAddress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import java.io.InputStream
import java.util.UUID

/**
 * GRPC_SERVER Node0 단위 핸들러.
 *
 * ■ 역할
 *   - [buildServiceDefinition] 으로 gRPC ServerServiceDefinition 을 생성해
 *     GrpcServerManager 에 등록한다.
 *   - 클라이언트 스트림이 열릴 때마다 streamId 를 발급하고
 *     GrpcSessionRegistry 에 responseObserver 를 등록한다.
 *   - 수신 메시지를 DynamicMessage → Map 으로 변환한 뒤 WorkflowDispatcher 에 전달한다.
 *   - 스트림 종료(onCompleted / onError) 시 레지스트리에서 세션을 제거한다.
 */
class GrpcServerHandler(
    val unit: WorkflowUnit,
    val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: GrpcSessionRegistry,
    private val requestDescriptor: Descriptors.Descriptor,
    private val responseDescriptor: Descriptors.Descriptor
) {
    private val log = LoggerFactory.getLogger(javaClass)

    val serviceName: String = definition.grpcServiceName ?: "MessageInterfaceService"
    val methodName:  String = definition.grpcMethodName  ?: "BiStream"

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ── ServerServiceDefinition 생성 ──────────────────────────────────────────

    fun buildServiceDefinition(): ServerServiceDefinition {
        val methodDescriptor = buildMethodDescriptor()

        return ServerServiceDefinition
            .builder(
                ServiceDescriptor.newBuilder(serviceName)
                    .addMethod(methodDescriptor)
                    .build()
            )
            .addMethod(methodDescriptor, buildCallHandler())
            .build()
    }

    private fun buildMethodDescriptor(): MethodDescriptor<DynamicMessage, DynamicMessage> =
        MethodDescriptor.newBuilder<DynamicMessage, DynamicMessage>()
            .setType(MethodDescriptor.MethodType.BIDI_STREAMING)
            .setFullMethodName(MethodDescriptor.generateFullMethodName(serviceName, methodName))
            .setRequestMarshaller(DynamicMessageMarshaller(requestDescriptor))
            .setResponseMarshaller(DynamicMessageMarshaller(responseDescriptor))
            .build()

    // ── BidiStreaming 핸들러 ──────────────────────────────────────────────────

    /**
     * ServerCallHandler 를 직접 구현해 remote IP 를 캡처한다.
     * call.attributes 에서 TRANSPORT_ATTR_REMOTE_ADDR 를 읽어 GrpcSessionRegistry 에 함께 등록하고,
     * MessageContext.metadata["remoteIp"] 로도 전달한다.
     */
    private fun buildCallHandler(): ServerCallHandler<DynamicMessage, DynamicMessage> =
        ServerCallHandler { call, _ ->
            val remoteAddr = call.attributes.get(Grpc.TRANSPORT_ATTR_REMOTE_ADDR)
            val remoteIp   = (remoteAddr as? InetSocketAddress)?.address?.hostAddress ?: "unknown"
            val streamId   = UUID.randomUUID().toString()

            // 응답 헤더 전송 및 모든 수신 메시지 허용
            call.sendHeaders(Metadata())
            call.request(Int.MAX_VALUE)

            val responseObserver = object : StreamObserver<DynamicMessage> {
                override fun onNext(value: DynamicMessage) = call.sendMessage(value)
                override fun onError(t: Throwable)         = call.close(Status.fromThrowable(t), Metadata())
                override fun onCompleted()                 = call.close(Status.OK, Metadata())
            }

            sessionRegistry.register(unit.id, streamId, responseObserver, remoteIp)
            log.info("[gRPC Server] 클라이언트 연결: unitId={}, streamId={}, remoteIp={}", unit.id, streamId, remoteIp)

            object : ServerCall.Listener<DynamicMessage>() {
                override fun onMessage(message: DynamicMessage) {
                    val payload   = message.toByteArray()
                    val parsedMap = message.toMap().toMutableMap()
                    val endpoint  = "$serviceName/$methodName"
                    val ctx = MessageContext(
                        rawBytes      = payload,
                        endpoint      = endpoint,
                        protocol      = "GRPC_SERVER",
                        parsedMessage = parsedMap,
                        metadata      = mapOf(
                            "grpcStreamId" to streamId,
                            "unitId"       to unit.id,
                            "remoteIp"     to remoteIp
                        )
                    )
                    scope.launch {
                        try { dispatcher.dispatch(ctx) }
                        catch (e: Exception) {
                            log.error("[gRPC Server] 파이프라인 오류 (streamId={}): {}", streamId, e.message, e)
                        }
                    }
                }

                override fun onHalfClose() {
                    // 클라이언트 정상 종료 → 서버 측도 스트림 닫기
                    log.info("[gRPC Server] 클라이언트 정상 종료 (streamId={})", streamId)
                    sessionRegistry.remove(unit.id, streamId)
                    try { responseObserver.onCompleted() }
                    catch (e: Exception) {
                        log.warn("[gRPC Server] responseObserver.onCompleted() 실패: {}", e.message)
                    }
                }

                override fun onCancel() {
                    // 클라이언트 비정상 종료 또는 네트워크 단절 → 세션 제거만 수행
                    log.warn("[gRPC Server] 클라이언트 취소 (streamId={})", streamId)
                    sessionRegistry.remove(unit.id, streamId)
                }
            }
        }
}

// ── DynamicMessage 마샬러 ──────────────────────────────────────────────────────

/**
 * gRPC MethodDescriptor 에 사용할 DynamicMessage 직렬화/역직렬화기.
 * .proto 컴파일 없이 런타임 Descriptor 를 이용한다.
 */
class DynamicMessageMarshaller(
    private val descriptor: Descriptors.Descriptor
) : MethodDescriptor.Marshaller<DynamicMessage> {

    override fun stream(value: DynamicMessage): InputStream =
        value.toByteString().newInput()

    override fun parse(stream: InputStream): DynamicMessage =
        DynamicMessage.parseFrom(descriptor, stream)
}

// send-only gRPC 클라이언트(Node4)용: 응답 포맷이 달라도 스트림이 죽지 않도록 파싱 오류를 무시
class TolerantDynamicMessageMarshaller(
    private val descriptor: Descriptors.Descriptor
) : MethodDescriptor.Marshaller<DynamicMessage> {

    override fun stream(value: DynamicMessage): InputStream =
        value.toByteString().newInput()

    override fun parse(stream: InputStream): DynamicMessage = try {
        DynamicMessage.parseFrom(descriptor, stream)
    } catch (_: Exception) {
        DynamicMessage.newBuilder(descriptor).build()
    }
}
