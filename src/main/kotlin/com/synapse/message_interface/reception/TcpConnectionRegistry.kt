package com.synapse.message_interface.reception

import org.springframework.stereotype.Component
import reactor.netty.Connection
import java.util.concurrent.ConcurrentHashMap

@Component
class TcpConnectionRegistry {
    private val connections = ConcurrentHashMap<String, Connection>()

    fun register(unitId: String, connection: Connection) {
        connections.put(unitId, connection)?.dispose()
    }

    fun remove(unitId: String) {
        connections.remove(unitId)
    }

    fun send(unitId: String, data: ByteArray) {
        val conn = connections[unitId] ?: throw IllegalStateException("TCP 연결 없음: $unitId")
        conn.outbound().sendByteArray(reactor.core.publisher.Mono.just(data)).then().subscribe()
    }
}
