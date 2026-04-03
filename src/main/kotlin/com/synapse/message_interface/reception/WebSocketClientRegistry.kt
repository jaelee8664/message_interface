package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.MessageFormat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.reactive.socket.WebSocketSession
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient
import reactor.core.publisher.Mono
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * Node4 WEBSOCKET_CLIENT 전용 persistent connection 관리.
 * 동일 key(host:port/path)에 대해 하나의 연결을 유지하며, 연결 끊김 시 자동 재연결한다.
 */
@Component
class WebSocketClientRegistry {
    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<WebSocketSession>>()
    private val reconnectFlags = ConcurrentHashMap<String, Boolean>()   // key → reconnectEnabled
    private val reconnectDelays = ConcurrentHashMap<String, Long>()     // key → delayMs
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * 기존 열린 세션을 반환하거나, 없으면 새 persistent 연결을 수립한 뒤 반환한다.
     * 동시에 같은 key로 여러 코루틴이 호출해도 연결은 한 번만 생성된다.
     */
    suspend fun getOrConnect(
        key: String,
        uri: URI,
        reconnectEnabled: Boolean = true,
        reconnectDelaySeconds: Int = 5
    ): WebSocketSession {
        reconnectFlags[key] = reconnectEnabled
        reconnectDelays[key] = reconnectDelaySeconds * 1000L

        sessions[key]?.takeIf { it.isOpen }?.let { return it }

        val newDeferred = CompletableDeferred<WebSocketSession>()
        val existing = pending.putIfAbsent(key, newDeferred)

        return if (existing == null) {
            scope.launch { connectLoop(key, uri, newDeferred) }
            newDeferred.await()
        } else {
            existing.await()
        }
    }

    private suspend fun connectLoop(
        key: String,
        uri: URI,
        initialDeferred: CompletableDeferred<WebSocketSession>
    ) {
        var firstAttempt = true
        while (true) {
            try {
                log.info("[WS Client Registry] 연결 시도: $uri (key=$key)")
                ReactorNettyWebSocketClient().execute(uri) { session ->
                    sessions[key] = session
                    if (firstAttempt) {
                        initialDeferred.complete(session)
                        pending.remove(key)
                        firstAttempt = false
                    }
                    log.info("[WS Client Registry] 연결 성공: key=$key")
                    session.receive()
                        .doFinally {
                            sessions.remove(key)
                            log.info("[WS Client Registry] 연결 종료: key=$key")
                        }
                        .then()
                }.awaitFirstOrNull()
            } catch (e: Exception) {
                sessions.remove(key)
                if (firstAttempt) {
                    initialDeferred.completeExceptionally(e)
                    pending.remove(key)
                    log.warn("[WS Client Registry] 초기 연결 실패 (key=$key): ${e.message}")
                    return
                }
                log.warn("[WS Client Registry] 연결 끊김, 재연결 대기 (key=$key): ${e.message}")
            }

            if (!firstAttempt) {
                if (reconnectFlags[key] == false) {
                    log.info("[WS Client Registry] 재연결 비활성화, 중지: key=$key")
                    return
                }
                delay(reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT)
            } else {
                return
            }
        }
    }

    fun send(key: String, data: ByteArray, format: MessageFormat) {
        val session = sessions[key]
            ?: throw IllegalStateException("WebSocket 연결 없음: $key")
        if (!session.isOpen) throw IllegalStateException("WebSocket 세션 닫힘: $key")
        val msg = when (format) {
            MessageFormat.JSON, MessageFormat.XML ->
                session.textMessage(String(data, Charsets.UTF_8))
        }
        session.send(Mono.just(msg)).subscribe()
    }

    fun isConnected(key: String) = sessions[key]?.isOpen == true

    fun remove(key: String) {
        reconnectFlags[key] = false   // 재연결 루프 중지
        sessions.remove(key)?.let { if (it.isOpen) it.close().subscribe() }
        reconnectFlags.remove(key)
        reconnectDelays.remove(key)
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
