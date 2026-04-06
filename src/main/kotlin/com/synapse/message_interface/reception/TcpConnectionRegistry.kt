package com.synapse.message_interface.reception

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.stereotype.Component
import reactor.core.publisher.Sinks
import reactor.netty.Connection
import java.util.concurrent.ConcurrentHashMap

@Component
class TcpConnectionRegistry {
    private val connections = ConcurrentHashMap<String, Connection>()
    private val sinks = ConcurrentHashMap<String, Sinks.Many<ByteArray>>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun register(unitId: String, connection: Connection) {
        val sink = Sinks.many().unicast().onBackpressureBuffer<ByteArray>()
        // 이전 연결의 sink를 먼저 완료시키고 교체
        sinks.put(unitId, sink)?.tryEmitComplete()
        connections.put(unitId, connection)?.dispose()

        // persistent outbound — sink가 완료될 때까지 outboundDone이 되지 않음
        scope.launch {
            connection.outbound()
                .sendByteArray(sink.asFlux())
                .then()
                .awaitFirstOrNull()
        }
    }

    fun remove(unitId: String) {
        sinks.remove(unitId)?.tryEmitComplete()
        connections.remove(unitId)
    }

    /** 현재 등록된 connection이 [connection]과 동일한 경우에만 제거 (재연결 후 새 connection을 덮어쓰지 않음) */
    fun removeIfSame(unitId: String, connection: Connection) {
        if (connections.remove(unitId, connection)) {
            sinks.remove(unitId)?.tryEmitComplete()
        }
    }

    fun send(unitId: String, data: ByteArray) {
        val sink = sinks[unitId] ?: throw IllegalStateException("TCP 연결 없음: $unitId")
        val result = sink.tryEmitNext(data)
        if (result.isFailure) {
            throw IllegalStateException("TCP 송신 버퍼 실패 (unitId=$unitId): $result")
        }
    }
}
