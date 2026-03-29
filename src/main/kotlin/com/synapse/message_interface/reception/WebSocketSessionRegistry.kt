package com.synapse.message_interface.reception

import org.springframework.stereotype.Component
import org.springframework.web.reactive.socket.WebSocketSession
import reactor.core.publisher.Mono
import java.util.concurrent.ConcurrentHashMap

@Component
class WebSocketSessionRegistry {
    // unitId → latest WebSocketSession
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()

    fun register(unitId: String, session: WebSocketSession) {
        // Close old session before replacing
        sessions.put(unitId, session)?.let { old ->
            if (old.isOpen) old.close().subscribe()
        }
    }

    fun getSession(unitId: String): WebSocketSession? = sessions[unitId]

    fun remove(unitId: String) {
        sessions.remove(unitId)
    }

    fun send(unitId: String, data: ByteArray): Mono<Void> {
        val session = sessions[unitId] ?: return Mono.error(IllegalStateException("세션 없음: $unitId"))
        return session.send(Mono.just(session.textMessage(String(data, Charsets.UTF_8))))
    }
}
