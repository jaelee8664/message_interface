package com.synapse.message_interface.reception

import com.google.protobuf.Descriptors
import com.google.protobuf.DynamicMessage
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.reception.DynamicProtoUtil.toMap
import io.grpc.MethodDescriptor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/**
 * GRPC_CLIENT Node0 단위 핸들러.
 *
 * ■ 역할
 *   - GrpcClientRegistry.getOrConnect() 로 bidi stream 연결을 수립한다.
 *   - 서버로부터 메시지가 올 때마다 WorkflowDispatcher 에 전달한다.
 *   - stop() 시 GrpcClientRegistry.remove() 로 연결을 정리하고 재연결 루프를 중단한다.
 *
 * ■ 연결 key
 *   "{host}:{port}/{serviceName}/{methodName}"
 *   — GrpcClientRegistry 에서 Node4 GRPC_CLIENT 송신에도 동일 key 를 사용한다.
 *
 * ■ 죽은 소켓 정리
 *   GrpcClientRegistry 의 keepAlive 설정(30s/10s)으로 서버 무응답을 탐지하며,
 *   onError 콜백 → reconnect loop 로 자동 처리된다.
 *   stop() 은 running 플래그 없이 remove() 만으로 루프를 중단시킨다
 *   (TcpClientConnectionPool 의 reconnectFlags 패턴과 동일).
 */
class GrpcClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val clientRegistry: GrpcClientRegistry,
    private val requestDescriptor: Descriptors.Descriptor,
    private val responseDescriptor: Descriptors.Descriptor
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val serviceName: String = definition.grpcServiceName ?: "MessageInterfaceService"
    private val methodName:  String = definition.grpcMethodName  ?: "BiStream"

    /** GrpcClientRegistry 및 Node4 송신에서 공통으로 사용하는 연결 키 */
    val connKey: String
        get() = "${definition.host ?: "localhost"}:${definition.port ?: 9090}/$serviceName/$methodName"

    private val methodDescriptor: MethodDescriptor<DynamicMessage, DynamicMessage> by lazy {
        MethodDescriptor.newBuilder<DynamicMessage, DynamicMessage>()
            .setType(MethodDescriptor.MethodType.BIDI_STREAMING)
            .setFullMethodName(MethodDescriptor.generateFullMethodName(serviceName, methodName))
            .setRequestMarshaller(DynamicMessageMarshaller(requestDescriptor))
            .setResponseMarshaller(DynamicMessageMarshaller(responseDescriptor))
            .build()
    }

    fun start() {
        scope.launch { connect() }
    }

    fun stop() {
        // remove() 가 reconnectFlags[key] = false 로 루프를 중단시킨다
        clientRegistry.remove(connKey)
        scope.cancel()
    }

    private suspend fun connect() {
        val endpoint = "$serviceName/$methodName"
        try {
            clientRegistry.getOrConnect(
                key = connKey,
                host = definition.host ?: "localhost",
                port = definition.port ?: 9090,
                methodDescriptor = methodDescriptor,
                onMessage = { message ->
                    val payload   = message.toByteArray()
                    val parsedMap = message.toMap().toMutableMap()
                    val ctx = MessageContext(
                        rawBytes      = payload,
                        endpoint      = endpoint,
                        protocol      = "GRPC_CLIENT",
                        parsedMessage = parsedMap,
                        metadata      = mapOf("unitId" to unit.id)
                    )
                    try { dispatcher.dispatch(ctx) }
                    catch (e: Exception) {
                        log.error("[gRPC Client] 파이프라인 오류 (unitId={}): {}", unit.id, e.message, e)
                    }
                },
                reconnectDelaySeconds = definition.reconnectDelaySeconds,
                pingEnabled           = definition.pingEnabled,
                pingIntervalSeconds   = definition.pingIntervalSeconds,
                pongTimeoutSeconds    = definition.pongTimeoutSeconds
            )
            log.info("[gRPC Client] 핸들러 연결 완료: unitId={}, key={}", unit.id, connKey)
        } catch (e: Exception) {
            log.error("[gRPC Client] 핸들러 초기 연결 실패 (unitId={}): {}", unit.id, e.message)
        }
    }
}
