package com.synapse.message_interface.reception

import io.netty.channel.ChannelOption
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.reactive.awaitSingle
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import reactor.core.publisher.Mono
import reactor.core.publisher.Sinks
import reactor.netty.Connection
import reactor.netty.tcp.TcpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * WebSocket 클라이언트 연결 풀 (Node0 수신 + Node4 송신 공유).
 *
 * - 동일 key(host:port)에 대해 연결을 하나만 유지한다.
 * - Node0가 onMessage 콜백과 함께 먼저 연결하면 해당 연결로 수신/송신 모두 처리된다.
 * - Node4가 먼저 연결하면 onMessage 없이 연결을 수립하고, 이후 Node0가 같은 key로
 *   getOrConnect() 호출 시 onMessage만 등록된다 (새 연결 생성 없음).
 * - 연결이 끊기면 항상 재연결을 시도한다. remove() 호출 시에만 루프가 중단된다.
 */
@Component
class TcpClientConnectionPool {
    private val log = LoggerFactory.getLogger(javaClass)
    private val connections    = ConcurrentHashMap<String, Connection>()
    private val sinks          = ConcurrentHashMap<String, Sinks.Many<ByteArray>>()
    private val pending        = ConcurrentHashMap<String, CompletableDeferred<Connection>>()
    private val loopRunning    = ConcurrentHashMap.newKeySet<String>()
    private val stoppedKeys    = ConcurrentHashMap.newKeySet<String>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val onMessageHandlers = ConcurrentHashMap<String, suspend (ByteArray) -> Unit>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    suspend fun getOrConnect(
        key: String,
        host: String,
        port: Int,
        reconnectDelaySeconds: Int = 5,
        onMessage: (suspend (ByteArray) -> Unit)? = null
    ): Connection {
        stoppedKeys.remove(key)
        reconnectDelays[key] = reconnectDelaySeconds * 1000L
        if (onMessage != null) onMessageHandlers[key] = onMessage

        connections[key]?.takeIf { !it.isDisposed }?.let { return it }

        val newDeferred = CompletableDeferred<Connection>()
        val existing = pending.putIfAbsent(key, newDeferred)
        if (existing != null) return existing.await()

        if (loopRunning.add(key)) {
            scope.launch { connectLoop(key, host, port) }
        }

        return newDeferred.await()
    }

    private suspend fun connectLoop(key: String, host: String, port: Int) {
        try {
            while (true) {
                val currentDeferred = pending.computeIfAbsent(key) { CompletableDeferred() }
                var sink: Sinks.Many<ByteArray>? = null
                var connection: Connection? = null

                try {
                    log.info("[TCP Pool] 연결 시도: $host:$port (key=$key)")
                    sink = Sinks.many().multicast().onBackpressureBuffer()
                    connection = TcpClient.create()
                        .host(host)
                        .port(port)
                        .option(ChannelOption.SO_KEEPALIVE, true)
                        .connect()
                        .awaitSingle()

                    connections[key] = connection
                    sinks[key] = sink
                    log.info("[TCP Pool] 연결 성공: key=$key")

                    scope.launch {
                        runCatching {
                            connection.outbound()
                                .sendByteArray(sink.asFlux())
                                .then()
                                .awaitFirstOrNull()
                        }.onFailure { e -> log.warn("[TCP Pool] 송신 오류 (key=$key): ${e.message}") }
                    }

                    scope.launch {
                        connection.inbound().receive()
                            .flatMap { buf ->
                                val payload = ByteArray(buf.readableBytes())
                                try { buf.readBytes(payload) } finally { buf.release() }
                                mono {
                                    onMessageHandlers[key]?.invoke(payload)
                                }.onErrorResume { e ->
                                    log.error("[TCP Pool] 메시지 처리 오류 (key=$key): ${e.message}", e)
                                    Mono.empty()
                                }
                            }
                            .then()
                            .awaitFirstOrNull()
                    }

                    currentDeferred.complete(connection)
                    pending.remove(key, currentDeferred)

                    connection.onDispose().awaitFirstOrNull()

                    if (sinks.remove(key, sink)) sink.tryEmitComplete()
                    connections.remove(key, connection)
                    log.info("[TCP Pool] 연결 종료: key=$key")

                } catch (e: Exception) {
                    connection?.let { connections.remove(key, it) }
                    sink?.let { if (sinks.remove(key, it)) it.tryEmitComplete() }
                    if (!currentDeferred.isCompleted) currentDeferred.completeExceptionally(e)
                    pending.remove(key, currentDeferred)
                    log.warn("[TCP Pool] 연결 실패 (key=$key): ${e.message}")
                }

                if (stoppedKeys.contains(key)) break

                val reconnectDeferred = CompletableDeferred<Connection>()
                pending.putIfAbsent(key, reconnectDeferred)

                val delayMs = reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT
                log.info("[TCP Pool] ${delayMs / 1000}초 후 재연결: key=$key")
                delay(delayMs)
            }
        } finally {
            loopRunning.remove(key)
            pending.remove(key)?.let { d ->
                if (!d.isCompleted) {
                    d.completeExceptionally(IllegalStateException("[TCP Pool] 연결 중단, 루프 종료: $key"))
                }
            }
        }
    }

    fun send(key: String, data: ByteArray) {
        val sink = sinks[key] ?: throw IllegalStateException("TCP 연결 없음: $key")
        val result = sink.tryEmitNext(data)
        if (result.isFailure) throw IllegalStateException("TCP 송신 버퍼 실패 (key=$key): $result")
    }

    fun getAll(): Map<String, Boolean> =
        connections.mapValues { (_, c) -> !c.isDisposed }

    fun isConnected(key: String) = connections[key]?.isDisposed == false

    fun remove(key: String) {
        stoppedKeys.add(key)
        onMessageHandlers.remove(key)
        reconnectDelays.remove(key)
        sinks.remove(key)?.tryEmitComplete()
        connections.remove(key)?.dispose()
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
