package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.MessageFormat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.reactive.socket.WebSocketSession
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient
import reactor.core.publisher.Mono
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * WebSocket 클라이언트 연결 풀 (Node0 수신 + Node4 송신 공유).
 *
 * - 동일 key(host:port/path)에 대해 세션을 하나만 유지한다.
 * - Node0가 onMessage 콜백과 함께 먼저 연결하면 해당 세션으로 수신/송신 모두 처리된다.
 * - Node4가 먼저 연결하면 onMessage 없이 세션을 수립하고, 이후 Node0가 같은 key로
 *   getOrConnect() 호출 시 onMessage만 등록된다 (새 연결 생성 없음).
 * - retryOnFirstFailure=true(Node0 전용): 초기 연결 실패 시에도 재시도한다.
 */
@Component
class WebSocketClientRegistry {
    private val log = LoggerFactory.getLogger(javaClass)

    private val sessions        = ConcurrentHashMap<String, WebSocketSession>()
    private val pending         = ConcurrentHashMap<String, CompletableDeferred<WebSocketSession>>()
    private val loopRunning     = ConcurrentHashMap.newKeySet<String>()
    private val stoppedKeys     = ConcurrentHashMap.newKeySet<String>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val pingEnabledMap  = ConcurrentHashMap<String, Boolean>()
    private val pingIntervals   = ConcurrentHashMap<String, Long>()
    private val pongTimeouts    = ConcurrentHashMap<String, Long>()
    private val onMessageHandlers = ConcurrentHashMap<String, suspend (ByteArray) -> Unit>()
    private val wsClient = ReactorNettyWebSocketClient()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    suspend fun getOrConnect(
        key: String,
        uri: URI,
        reconnectDelaySeconds: Int = 5,
        pingEnabled: Boolean = false,
        pingIntervalSeconds: Int = 30,
        pongTimeoutSeconds: Int = 10,
        onMessage: (suspend (ByteArray) -> Unit)? = null,
        retryOnFirstFailure: Boolean = false
    ): WebSocketSession {
        stoppedKeys.remove(key)
        reconnectDelays[key] = reconnectDelaySeconds * 1000L
        pingEnabledMap[key]  = pingEnabled
        pingIntervals[key]   = pingIntervalSeconds * 1000L
        pongTimeouts[key]    = pongTimeoutSeconds * 1000L
        if (onMessage != null) onMessageHandlers[key] = onMessage

        sessions[key]?.takeIf { it.isOpen }?.let { return it }

        val newDeferred = CompletableDeferred<WebSocketSession>()
        val existing = pending.putIfAbsent(key, newDeferred)

        return if (existing == null) {
            if (loopRunning.add(key)) {
                scope.launch { connectLoop(key, uri, newDeferred, retryOnFirstFailure) }
            }
            newDeferred.await()
        } else {
            existing.await()
        }
    }

    private suspend fun connectLoop(
        key: String,
        uri: URI,
        initialDeferred: CompletableDeferred<WebSocketSession>,
        retryOnFirstFailure: Boolean
    ) {
        try {
            var connected = false
            while (true) {
                try {
                    log.info("[WS Client] 연결 시도: $uri (key=$key)")
                    wsClient.execute(uri) { session ->
                        sessions[key] = session
                        if (!connected) {
                            initialDeferred.complete(session)
                            pending.remove(key)
                            connected = true
                        } else {
                            // 재연결 성공 — 대기 중인 getOrConnect 호출 완료
                            pending.remove(key)?.let { if (!it.isCompleted) it.complete(session) }
                        }
                        log.info("[WS Client] 연결 성공: key=$key")

                        val lastPongTime = AtomicLong(System.currentTimeMillis())

                        val pingJob = if (pingEnabledMap[key] == true) {
                            scope.launch {
                                while (session.isOpen) {
                                    delay(pingIntervals[key] ?: 30_000L)
                                    if (!session.isOpen) break

                                    val pingSentAt = System.currentTimeMillis()
                                    try {
                                        session.send(Mono.just(session.pingMessage { it.wrap(ByteArray(0)) }))
                                            .awaitFirstOrNull()
                                    } catch (e: Exception) {
                                        log.warn("[WS Client] Ping 전송 실패 (key=$key): ${e.message}")
                                        session.close().awaitFirstOrNull()
                                        break
                                    }

                                    delay(pongTimeouts[key] ?: 10_000L)
                                    if (lastPongTime.get() < pingSentAt) {
                                        log.warn("[WS Client] Pong 미응답, 강제 종료 (key=$key)")
                                        session.close().awaitFirstOrNull()
                                        break
                                    }
                                }
                            }
                        } else null

                        session.receive()
                            .doOnNext { msg ->
                                if (msg.type.name.contains("PONG")) lastPongTime.set(System.currentTimeMillis())
                            }
                            .filter { !it.type.name.contains("PONG") }
                            .flatMap { message ->
                                val buf = message.payload
                                val payload = ByteArray(buf.readableByteCount()).also { buf.read(it) }
                                mono {
                                    onMessageHandlers[key]?.invoke(payload)
                                }.onErrorResume { e ->
                                    log.error("[WS Client] 메시지 처리 오류 (key=$key): ${e.message}", e)
                                    Mono.empty()
                                }
                            }
                            .doFinally {
                                pingJob?.cancel()
                                sessions.remove(key)
                                log.info("[WS Client] 연결 종료: key=$key")
                            }
                            .then()
                    }.awaitFirstOrNull()
                } catch (e: Exception) {
                    sessions.remove(key)
                    if (!connected) {
                        if (!retryOnFirstFailure) {
                            initialDeferred.completeExceptionally(e)
                            pending.remove(key)
                            log.warn("[WS Client] 초기 연결 실패 (key=$key): ${e.message}")
                            return
                        }
                        log.warn("[WS Client] 초기 연결 실패, 재시도 (key=$key): ${e.message}")
                    } else {
                        log.warn("[WS Client] 연결 끊김, 재연결 대기 (key=$key): ${e.message}")
                    }
                }

                if (stoppedKeys.contains(key)) {
                    if (!connected && !initialDeferred.isCompleted) {
                        initialDeferred.completeExceptionally(CancellationException("연결 중단: $key"))
                    }
                    log.info("[WS Client] 연결 중단: key=$key")
                    return
                }
                delay(reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT)
            }
        } finally {
            loopRunning.remove(key)
            pending.remove(key)?.let { if (!it.isCompleted) it.completeExceptionally(CancellationException("연결 루프 종료: $key")) }
        }
    }

    suspend fun send(key: String, data: ByteArray, format: MessageFormat) {
        val session = sessions[key]
            ?: throw IllegalStateException("WebSocket 연결 없음: $key")
        if (!session.isOpen) throw IllegalStateException("WebSocket 세션 닫힘: $key")
        val msg = when (format) {
            MessageFormat.JSON, MessageFormat.XML ->
                session.textMessage(String(data, Charsets.UTF_8))
            MessageFormat.PROTOBUF ->
                throw IllegalArgumentException("WebSocket은 PROTOBUF 포맷을 지원하지 않습니다")
        }
        session.send(Mono.just(msg)).awaitFirstOrNull()
    }

    fun getAll(): Map<String, Boolean> =
        sessions.mapValues { (_, s) -> s.isOpen }

    fun isConnected(key: String) = sessions[key]?.isOpen == true

    fun remove(key: String) {
        stoppedKeys.add(key)
        onMessageHandlers.remove(key)
        reconnectDelays.remove(key)
        pingEnabledMap.remove(key)
        pingIntervals.remove(key)
        pongTimeouts.remove(key)
        sessions.remove(key)?.let { if (it.isOpen) scope.launch { it.close().awaitFirstOrNull() } }
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
