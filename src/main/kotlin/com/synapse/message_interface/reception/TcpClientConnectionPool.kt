package com.synapse.message_interface.reception

import io.netty.channel.ChannelOption
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import reactor.core.publisher.Mono
import reactor.netty.Connection
import reactor.netty.tcp.TcpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * Node4 TCP_CLIENT 전용 persistent connection 관리.
 * WebSocketClientRegistry와 동일한 패턴으로, 동일 key(host:port)에 대해
 * 하나의 연결을 유지하며 연결 끊김 시 자동 재연결한다.
 *
 * TCP는 프로토콜 레벨 ping/pong이 없으므로 SO_KEEPALIVE(OS 레벨 keepalive)를 사용한다.
 */
@Component
class TcpClientConnectionPool {
    private val log = LoggerFactory.getLogger(javaClass)
    private val connections = ConcurrentHashMap<String, Connection>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Connection>>()
    private val reconnectFlags = ConcurrentHashMap<String, Boolean>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * 기존 열린 연결을 반환하거나, 없으면 새 persistent 연결을 수립한 뒤 반환한다.
     * 동시에 같은 key로 여러 코루틴이 호출해도 연결은 한 번만 생성된다.
     */
    suspend fun getOrConnect(
        key: String,
        host: String,
        port: Int,
        reconnectEnabled: Boolean = true,
        reconnectDelaySeconds: Int = 5
    ): Connection {
        reconnectFlags[key] = reconnectEnabled
        reconnectDelays[key] = reconnectDelaySeconds * 1000L

        connections[key]?.takeIf { !it.isDisposed }?.let { return it }

        val newDeferred = CompletableDeferred<Connection>()
        val existing = pending.putIfAbsent(key, newDeferred)

        return if (existing == null) {
            scope.launch { connectLoop(key, host, port, newDeferred) }
            newDeferred.await()
        } else {
            existing.await()
        }
    }

    private suspend fun connectLoop(
        key: String,
        host: String,
        port: Int,
        initialDeferred: CompletableDeferred<Connection>
    ) {
        var firstAttempt = true
        while (true) {
            try {
                log.info("[TCP Pool] 연결 시도: $host:$port (key=$key)")
                val connection = TcpClient.create()
                    .host(host)
                    .port(port)
                    .option(ChannelOption.SO_KEEPALIVE, true)
                    .connectNow()

                connections[key] = connection
                if (firstAttempt) {
                    initialDeferred.complete(connection)
                    pending.remove(key)
                    firstAttempt = false
                }
                log.info("[TCP Pool] 연결 성공: key=$key")

                // 수신 데이터 drain — 서버 응답이 와도 버퍼가 쌓이지 않도록
                connection.inbound().receive()
                    .doOnNext { it.release() }
                    .subscribe()

                connection.onDispose().awaitFirstOrNull()
                connections.remove(key)
                log.info("[TCP Pool] 연결 종료: key=$key")

            } catch (e: Exception) {
                connections.remove(key)
                if (firstAttempt) {
                    initialDeferred.completeExceptionally(e)
                    pending.remove(key)
                    log.warn("[TCP Pool] 초기 연결 실패 (key=$key): ${e.message}")
                    return
                }
                log.warn("[TCP Pool] 연결 끊김 (key=$key): ${e.message}")
            }

            if (reconnectFlags[key] == false) {
                log.info("[TCP Pool] 재연결 비활성화, 중지: key=$key")
                return
            }
            delay(reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT)
        }
    }

    fun send(key: String, data: ByteArray) {
        val conn = connections[key]?.takeIf { !it.isDisposed }
            ?: throw IllegalStateException("TCP 연결 없음: $key")
        conn.outbound()
            .sendByteArray(Mono.just(data))
            .then()
            .subscribe()
    }

    fun isConnected(key: String) = connections[key]?.isDisposed == false

    fun remove(key: String) {
        reconnectFlags[key] = false
        connections.remove(key)?.dispose()
        reconnectFlags.remove(key)
        reconnectDelays.remove(key)
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
