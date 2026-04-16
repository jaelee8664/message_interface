package com.synapse.message_interface.reception

import com.google.protobuf.Descriptors
import com.google.protobuf.DynamicMessage
import io.grpc.CallOptions
import io.grpc.ManagedChannel
import io.grpc.ManagedChannelBuilder
import io.grpc.MethodDescriptor
import io.grpc.stub.ClientCalls
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * GRPC_CLIENT Node0 및 Node4 전용: 클라이언트 bidi stream 풀.
 *
 * ■ TcpClientConnectionPool 설계를 그대로 따른다.
 *   - loopRunning Set 으로 key 별 루프를 하나만 실행
 *   - pending ConcurrentHashMap 으로 재연결 대기 구간에도 중복 루프 방지
 *   - remove(key, value) 형태로 교차 오염 방지
 *
 * ■ ManagedChannel 수명
 *   - key (host:port/service/method) 별로 채널을 생성하며, 스트림 오류 시에도
 *     채널은 재사용한다 (gRPC 채널 자체가 재연결을 내부에서 처리).
 *   - 채널이 shutdown/terminated 상태이면 새 채널을 생성한다.
 *
 * ■ 죽은 스트림 감지
 *   - keepAliveTime / keepAliveTimeout 으로 서버 무응답을 탐지한다.
 *   - 탐지 시 onError 콜백이 호출되어 reconnect loop 가 재실행된다.
 */
@Component
class GrpcClientRegistry {
    private val log = LoggerFactory.getLogger(javaClass)

    private val channels        = ConcurrentHashMap<String, ManagedChannel>()
    private val requestObservers = ConcurrentHashMap<String, StreamObserver<DynamicMessage>>()
    private val pending         = ConcurrentHashMap<String, CompletableDeferred<StreamObserver<DynamicMessage>>>()
    private val loopRunning     = ConcurrentHashMap.newKeySet<String>()
    private val stoppedKeys     = ConcurrentHashMap.newKeySet<String>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val pingEnabledMap  = ConcurrentHashMap<String, Boolean>()
    private val pingIntervals   = ConcurrentHashMap<String, Long>()
    private val pongTimeouts    = ConcurrentHashMap<String, Long>()
    private val scope           = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Node0 핸들러 스트림 추적 (모니터링 전용)
    private val handlerObservers = ConcurrentHashMap<String, StreamObserver<DynamicMessage>>()

    // ── 공개 API ──────────────────────────────────────────────────────────────

    /**
     * 살아있는 스트림 옵저버를 반환하거나, 없으면 연결 루프를 시작한 뒤 반환한다.
     * [onMessage]: 서버에서 메시지가 올 때 호출할 코루틴 suspend 함수.
     */
    suspend fun getOrConnect(
        key: String,
        host: String,
        port: Int,
        methodDescriptor: MethodDescriptor<DynamicMessage, DynamicMessage>,
        onMessage: suspend (DynamicMessage) -> Unit,
        reconnectDelaySeconds: Int = 5,
        pingEnabled: Boolean = false,
        pingIntervalSeconds: Int = 30,
        pongTimeoutSeconds: Int = 10
    ): StreamObserver<DynamicMessage> {
        stoppedKeys.remove(key)
        reconnectDelays[key] = reconnectDelaySeconds * 1000L
        pingEnabledMap[key] = pingEnabled
        pingIntervals[key]  = pingIntervalSeconds * 1000L
        pongTimeouts[key]   = pongTimeoutSeconds * 1000L

        // 빠른 경로: 살아있는 옵저버 즉시 반환
        requestObservers[key]?.let { return it }

        // 느린 경로: pending 대기 or 새 deferred 등록
        val newDeferred = CompletableDeferred<StreamObserver<DynamicMessage>>()
        val existing = pending.putIfAbsent(key, newDeferred)
        if (existing != null) return existing.await()

        // 루프가 실행 중이지 않은 경우에만 새 루프 시작
        if (loopRunning.add(key)) {
            scope.launch { connectLoop(key, host, port, methodDescriptor, onMessage) }
        }
        return newDeferred.await()
    }

    fun send(key: String, message: DynamicMessage) {
        val obs = requestObservers[key]
            ?: throw IllegalStateException("gRPC 스트림 없음: $key")
        obs.onNext(message)
    }

    /**
     * Node4 GRPC_CLIENT 전용: 스트림이 없을 때 자동으로 연결을 시작한다.
     * 수신 메시지는 무시 (Node4 송신 전용 연결).
     */
    suspend fun getOrConnectForSendOnly(
        key: String,
        host: String,
        port: Int,
        svcName: String,
        methodName: String,
        requestDescriptor: Descriptors.Descriptor,
        responseDescriptor: Descriptors.Descriptor,
        reconnectDelaySeconds: Int = 5
    ) {
        val md = MethodDescriptor.newBuilder<DynamicMessage, DynamicMessage>()
            .setType(MethodDescriptor.MethodType.BIDI_STREAMING)
            .setFullMethodName(MethodDescriptor.generateFullMethodName(svcName, methodName))
            .setRequestMarshaller(DynamicMessageMarshaller(requestDescriptor))
            .setResponseMarshaller(DynamicMessageMarshaller(responseDescriptor))
            .build()
        getOrConnect(
            key = key,
            host = host,
            port = port,
            methodDescriptor = md,
            onMessage = { /* Node4 송신 전용: 수신 메시지 무시 */ },
            reconnectDelaySeconds = reconnectDelaySeconds
        )
    }

    // Node0 핸들러 추적 (모니터링 전용)
    fun registerHandlerObserver(key: String, observer: StreamObserver<DynamicMessage>) {
        handlerObservers[key] = observer
    }
    fun removeHandlerObserver(key: String) { handlerObservers.remove(key) }

    fun getAll(): Map<String, Boolean> =
        requestObservers.mapValues { true } + handlerObservers.mapValues { true }

    /**
     * 모니터링용: 재연결 루프가 활성화된 모든 키와 현재 연결 여부를 반환.
     * 연결 중(CONNECTED) 또는 재연결 대기 중(RECONNECTING) 클라이언트를 모두 포함한다.
     */
    fun getStatus(): Map<String, Boolean> =
        loopRunning.associateWith { requestObservers.containsKey(it) }

    fun isConnected(key: String) = requestObservers.containsKey(key)

    /**
     * 재연결 루프를 중지하고 채널·스트림을 정리한다.
     * Node0 GRPC_CLIENT 핸들러의 stop() 에서 호출.
     */
    fun remove(key: String) {
        stoppedKeys.add(key)
        reconnectDelays.remove(key)
        pingEnabledMap.remove(key)
        pingIntervals.remove(key)
        pongTimeouts.remove(key)
        // 스트림을 먼저 정상 종료 신호
        requestObservers.remove(key)?.let {
            try { it.onCompleted() } catch (_: Exception) {}
        }
        // 채널 shutdown
        channels.remove(key)?.let {
            if (!it.isShutdown) {
                it.shutdown()
                try { it.awaitTermination(3, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
            }
        }
    }

    // ── 연결 루프 ─────────────────────────────────────────────────────────────

    private suspend fun connectLoop(
        key: String,
        host: String,
        port: Int,
        methodDescriptor: MethodDescriptor<DynamicMessage, DynamicMessage>,
        onMessage: suspend (DynamicMessage) -> Unit
    ) {
        try {
            while (true) {
                val currentDeferred = pending.computeIfAbsent(key) { CompletableDeferred() }
                var requestObserver: StreamObserver<DynamicMessage>? = null

                try {
                    log.info("[gRPC Client] 연결 시도: $host:$port (key=$key)")

                    // 채널 재사용 or 새로 생성 (shutdown/terminated 이면 재생성)
                    val channel = channels[key]
                        ?.takeIf { !it.isShutdown && !it.isTerminated }
                        ?: run {
                            val builder = ManagedChannelBuilder.forAddress(host, port).usePlaintext()
                            if (pingEnabledMap[key] == true) {
                                builder
                                    .keepAliveTime(pingIntervals[key] ?: 30_000L, TimeUnit.MILLISECONDS)
                                    .keepAliveTimeout(pongTimeouts[key] ?: 10_000L, TimeUnit.MILLISECONDS)
                                    .keepAliveWithoutCalls(true)
                            }
                            builder.build().also { channels[key] = it }
                        }

                    // 스트림 종료 신호 (onError / onCompleted 중 먼저 완료되는 쪽)
                    val streamEnded = CompletableDeferred<Unit>()

                    val responseObserver = object : StreamObserver<DynamicMessage> {
                        override fun onNext(value: DynamicMessage) {
                            scope.launch {
                                try { onMessage(value) }
                                catch (e: Exception) {
                                    log.error("[gRPC Client] 메시지 처리 오류 (key=$key): ${e.message}", e)
                                }
                            }
                        }
                        override fun onError(t: Throwable) {
                            log.warn("[gRPC Client] 스트림 오류 (key=$key): ${t.message}")
                            streamEnded.completeExceptionally(t)
                        }
                        override fun onCompleted() {
                            log.info("[gRPC Client] 스트림 정상 종료 (key=$key)")
                            streamEnded.complete(Unit)
                        }
                    }

                    requestObserver = ClientCalls.asyncBidiStreamingCall(
                        channel.newCall(methodDescriptor, CallOptions.DEFAULT),
                        responseObserver
                    )
                    requestObservers[key] = requestObserver
                    log.info("[gRPC Client] 스트림 수립 성공: key=$key")

                    currentDeferred.complete(requestObserver)
                    pending.remove(key, currentDeferred)

                    // 스트림이 끝날 때까지 대기 (TCP pool 의 connection.onDispose() 와 동일한 패턴)
                    try { streamEnded.await() } catch (_: Exception) {}

                    // 교차 오염 방지: 자신의 옵저버만 제거
                    requestObservers.remove(key, requestObserver)
                    log.info("[gRPC Client] 스트림 종료 정리 완료: key=$key")

                } catch (e: Exception) {
                    requestObserver?.let { requestObservers.remove(key, it) }
                    if (!currentDeferred.isCompleted) currentDeferred.completeExceptionally(e)
                    pending.remove(key, currentDeferred)

                    // 채널 오류 시 다음 시도에서 재생성 (현재 채널 invalidate)
                    channels[key]?.let { ch ->
                        if (ch.isShutdown || ch.isTerminated) channels.remove(key, ch)
                    }
                    log.warn("[gRPC Client] 연결 실패 (key=$key): ${e.message}")
                }

                if (stoppedKeys.contains(key)) break

                // 재연결 대기 구간에도 pending 등록 → getOrConnect 가 새 루프를 만들지 않음
                val reconnectDeferred = CompletableDeferred<StreamObserver<DynamicMessage>>()
                pending.putIfAbsent(key, reconnectDeferred)

                val delayMs = reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT
                log.info("[gRPC Client] ${delayMs / 1000}초 후 재연결: key=$key")
                delay(delayMs)
            }
        } finally {
            loopRunning.remove(key)
            pending.remove(key)?.let { d ->
                if (!d.isCompleted) {
                    d.completeExceptionally(
                        IllegalStateException("[gRPC Client] 연결 중단, 루프 종료: $key")
                    )
                }
            }
        }
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
