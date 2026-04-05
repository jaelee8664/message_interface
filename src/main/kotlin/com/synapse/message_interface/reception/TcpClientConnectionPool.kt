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
import reactor.core.publisher.Sinks
import reactor.netty.Connection
import reactor.netty.tcp.TcpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * Node4 TCP_CLIENT 전용 persistent connection 관리.
 *
 * ■ outbound 설계
 *   Sinks.many().multicast().onBackpressureBuffer() 사용:
 *   - unicast는 내부 SpscLinkedArrayQueue(단일 생산자 전용)이므로 복수 스레드가 동시에
 *     tryEmitNext()를 호출하면 데이터 손상/FAIL_NON_SERIALIZED 발생.
 *   - multicast는 MPSC 큐로 복수 생산자에 안전하다.
 *
 * ■ connectLoop 단일 실행 보장
 *   loopRunning 셋으로 key별 루프를 하나만 실행한다.
 *   재연결 대기 구간에도 pending에 deferred를 등록해 두어
 *   getOrConnect()가 새 루프를 추가 론칭하지 않도록 한다.
 *
 * ■ 교차 오염 방지
 *   cleanup 시 remove(key, value) 형태로 자신의 sink/connection만 제거한다.
 */
@Component
class TcpClientConnectionPool {
    private val log = LoggerFactory.getLogger(javaClass)
    private val connections = ConcurrentHashMap<String, Connection>()
    private val sinks = ConcurrentHashMap<String, Sinks.Many<ByteArray>>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Connection>>()
    private val loopRunning = ConcurrentHashMap.newKeySet<String>()
    private val reconnectFlags = ConcurrentHashMap<String, Boolean>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * 살아있는 연결을 반환하거나, 없으면 연결 루프가 수립한 뒤 반환한다.
     * 재연결 중인 경우 기존 루프가 완료될 때까지 대기한다 (중복 루프 없음).
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

        // 빠른 경로: 살아있는 연결 즉시 반환
        connections[key]?.takeIf { !it.isDisposed }?.let { return it }

        // 느린 경로: 기존 pending 대기 or 새 deferred 등록
        val newDeferred = CompletableDeferred<Connection>()
        val existing = pending.putIfAbsent(key, newDeferred)
        if (existing != null) {
            return existing.await()
        }

        // 루프가 실행 중이지 않은 경우에만 새 루프 시작
        if (loopRunning.add(key)) {
            scope.launch { connectLoop(key, host, port) }
        }
        // 루프가 이미 실행 중이면 루프가 재연결 후 newDeferred를 완료시켜 줌

        return newDeferred.await()
    }

    private suspend fun connectLoop(key: String, host: String, port: Int) {
        try {
            while (true) {
                // 이번 시도에 사용할 deferred — getOrConnect가 이미 등록했거나 이전 반복에서 등록함
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
                        .connectNow()

                    connections[key] = connection
                    sinks[key] = sink
                    log.info("[TCP Pool] 연결 성공: key=$key")

                    // persistent outbound — sink가 완료될 때까지 outboundDone 마킹 없음
                    connection.outbound()
                        .sendByteArray(sink.asFlux())
                        .then()
                        .subscribe(
                            null,
                            { e -> log.warn("[TCP Pool] 송신 오류 (key=$key): ${e.message}") }
                        )

                    // 수신 데이터 drain
                    connection.inbound().receive()
                        .doOnNext { it.release() }
                        .subscribe()

                    // 연결 수립 완료를 대기 중인 호출자에게 알림
                    currentDeferred.complete(connection)
                    pending.remove(key, currentDeferred)

                    connection.onDispose().awaitFirstOrNull()

                    // 자신의 sink/connection만 제거 (재연결 후 새 것과 교차 오염 방지)
                    if (sinks.remove(key, sink)) sink.tryEmitComplete()
                    connections.remove(key, connection)
                    log.info("[TCP Pool] 연결 종료: key=$key")

                } catch (e: Exception) {
                    connection?.let { connections.remove(key, it) }
                    sink?.let { if (sinks.remove(key, it)) it.tryEmitComplete() }
                    if (!currentDeferred.isCompleted) {
                        currentDeferred.completeExceptionally(e)
                    }
                    pending.remove(key, currentDeferred)
                    log.warn("[TCP Pool] 연결 실패 (key=$key): ${e.message}")
                }

                if (reconnectFlags[key] == false) break

                // 재연결 대기 전에 deferred 등록 → 이 구간에 getOrConnect()가 새 루프를 만들지 않음
                val reconnectDeferred = CompletableDeferred<Connection>()
                pending.putIfAbsent(key, reconnectDeferred)

                val delayMs = reconnectDelays[key] ?: RECONNECT_DELAY_MS_DEFAULT
                log.info("[TCP Pool] ${delayMs / 1000}초 후 재연결: key=$key")
                delay(delayMs)
            }
        } finally {
            loopRunning.remove(key)
            // 루프 종료 시 대기 중인 호출자에게 실패 알림
            pending.remove(key)?.let { d ->
                if (!d.isCompleted) {
                    d.completeExceptionally(IllegalStateException("[TCP Pool] 재연결 비활성화, 루프 종료: $key"))
                }
            }
        }
    }

    fun send(key: String, data: ByteArray) {
        val sink = sinks[key] ?: throw IllegalStateException("TCP 연결 없음: $key")
        val result = sink.tryEmitNext(data)
        if (result.isFailure) {
            throw IllegalStateException("TCP 송신 버퍼 실패 (key=$key): $result")
        }
    }

    fun getAll(): Map<String, Boolean> = connections.mapValues { (_, c) -> !c.isDisposed }

    fun isConnected(key: String) = connections[key]?.isDisposed == false

    fun remove(key: String) {
        reconnectFlags[key] = false
        reconnectDelays.remove(key)
        reconnectFlags.remove(key)
        sinks.remove(key)?.tryEmitComplete()
        connections.remove(key)?.dispose()
    }

    companion object {
        private const val RECONNECT_DELAY_MS_DEFAULT = 5_000L
    }
}
