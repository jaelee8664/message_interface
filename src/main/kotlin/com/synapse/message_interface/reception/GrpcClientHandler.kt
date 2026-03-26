package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.proto.MessageInterfaceServiceGrpc
import com.synapse.message_interface.proto.MessageRequest
import com.synapse.message_interface.proto.MessageResponse
import io.grpc.ManagedChannelBuilder
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import java.util.concurrent.TimeUnit

class GrpcClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val clientRegistry: GrpcClientRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO)
    @Volatile private var running = true
    @Volatile private var channel: io.grpc.ManagedChannel? = null

    fun start() {
        scope.launch { connectWithRetry() }
    }

    fun stop() {
        running = false
        clientRegistry.remove(unit.id)
        channel?.shutdown()?.awaitTermination(5, TimeUnit.SECONDS)
        log.info("[gRPC Client] 중지: unitId=${unit.id}")
    }

    private suspend fun connectWithRetry() {
        while (running) {
            try {
                connect()
            } catch (e: Exception) {
                log.error("[gRPC Client] 연결 실패: ${e.message}")
                clientRegistry.remove(unit.id)
            }

            if (running && definition.reconnectEnabled) {
                log.info("[gRPC Client] ${definition.reconnectDelaySeconds}초 후 재연결...")
                delay(definition.reconnectDelaySeconds * 1000L)
            } else {
                break
            }
        }
    }

    private suspend fun connect() {
        val host = definition.host ?: "localhost"
        val port = definition.port ?: 9090

        val managedChannel = ManagedChannelBuilder.forAddress(host, port)
            .usePlaintext()
            .build()
            .also { channel = it }

        val stub = MessageInterfaceServiceGrpc.newStub(managedChannel)
        log.info("[gRPC Client] 연결 시도: $host:$port")

        val latch = java.util.concurrent.CountDownLatch(1)

        val responseObserver = object : StreamObserver<MessageResponse> {
            override fun onNext(response: MessageResponse) {
                if (!response.success) {
                    log.warn("[gRPC Client] 서버 오류 응답: ${response.error}")
                    return
                }
                if (response.payload.isEmpty) return

                scope.launch {
                    try {
                        val ctx = MessageContext(
                            rawBytes = response.payload.toByteArray(),
                            protocol = "GRPC_CLIENT",
                            traceId = response.traceId.ifEmpty { java.util.UUID.randomUUID().toString() }
                        )
                        dispatcher.dispatch(ctx)
                    } catch (e: Exception) {
                        log.error("[gRPC Client] 수신 메세지 처리 오류: ${e.message}", e)
                    }
                }
            }

            override fun onError(t: Throwable) {
                log.error("[gRPC Client] 스트림 오류: ${t.message}")
                clientRegistry.remove(unit.id)
                latch.countDown()
            }

            override fun onCompleted() {
                log.info("[gRPC Client] 스트림 완료")
                clientRegistry.remove(unit.id)
                latch.countDown()
            }
        }

        val requestObserver = stub.processStream(responseObserver)
        clientRegistry.register(unit.id, requestObserver)
        log.info("[gRPC Client] Bidirectional streaming 시작: unitId=${unit.id}")

        // Ping loop: send empty ping requests to detect connection health
        val pingJob = if (definition.pingEnabled) {
            scope.launch {
                while (running && clientRegistry.isConnected(unit.id)) {
                    delay(definition.pingIntervalSeconds * 1000L)
                    try {
                        requestObserver.onNext(
                            MessageRequest.newBuilder()
                                .setPayload(com.google.protobuf.ByteString.copyFromUtf8("ping"))
                                .setFormat("JSON")
                                .setTraceId("ping-${System.currentTimeMillis()}")
                                .build()
                        )
                    } catch (e: Exception) {
                        log.warn("[gRPC Client] Ping 실패, 재연결 필요: ${e.message}")
                        break
                    }
                }
            }
        } else null

        // Block until stream ends
        latch.await()
        pingJob?.cancel()
    }
}
