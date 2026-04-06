package com.synapse.message_interface.reception

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.stereotype.Component
import org.springframework.web.reactive.socket.WebSocketSession
import reactor.core.publisher.Mono
import java.util.concurrent.ConcurrentHashMap

@Component
class WebSocketSessionRegistry {
    // unitId → latest WebSocketSession
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun register(unitId: String, session: WebSocketSession) {
        // Close old session before replacing
        sessions.put(unitId, session)?.let { old ->
            if (old.isOpen) scope.launch { old.close().awaitFirstOrNull() }
        }
    }

    fun getSession(unitId: String): WebSocketSession? = sessions[unitId]

    fun remove(unitId: String) {
        sessions.remove(unitId)
    }

    fun getAll(): Map<String, Boolean> = sessions.mapValues { (_, s) -> s.isOpen }

    fun getRemoteAddress(unitId: String): String? =
        sessions[unitId]?.handshakeInfo?.remoteAddress?.address?.hostAddress

    fun send(unitId: String, data: ByteArray): Mono<Void> {
        val session = sessions[unitId] ?: return Mono.error(IllegalStateException("세션 없음: $unitId"))
        return session.send(Mono.just(session.textMessage(String(data, Charsets.UTF_8))))
    }
}
