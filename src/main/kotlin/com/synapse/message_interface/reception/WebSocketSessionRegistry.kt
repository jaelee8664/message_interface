package com.synapse.message_interface.reception

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.reactive.socket.WebSocketSession
import reactor.core.publisher.Mono
import java.util.concurrent.ConcurrentHashMap

@Component
class WebSocketSessionRegistry {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // sessionId → WebSocketSession (다수의 클라이언트 동시 연결 지원)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()

    // clientIp → Set<sessionId> (같은 IP의 복수 세션 모두 추적 — IP 기반 라우팅용)
    private val ipToSessionIds = ConcurrentHashMap<String, MutableSet<String>>()

    // unitId → Set<sessionId> (유닛 중지 시 소속 세션 일괄 종료용)
    private val unitToSessionIds = ConcurrentHashMap<String, MutableSet<String>>()

    /**
     * 새 WebSocket 세션을 등록한다.
     * @return 등록된 sessionId
     */
    fun register(session: WebSocketSession, unitId: String): String {
        val sessionId = session.id
        val clientIp = session.handshakeInfo.remoteAddress?.address?.hostAddress

        sessions[sessionId] = session
        if (clientIp != null) {
            ipToSessionIds.computeIfAbsent(clientIp) { ConcurrentHashMap.newKeySet() }.add(sessionId)
        }
        unitToSessionIds.computeIfAbsent(unitId) { ConcurrentHashMap.newKeySet() }.add(sessionId)

        log.info("[WebSocket] 세션 등록: sessionId=$sessionId, unitId=$unitId, ip=$clientIp, 현재 연결 수=${sessions.size}")
        return sessionId
    }

    fun remove(sessionId: String) {
        val session = sessions.remove(sessionId) ?: return
        val clientIp = session.handshakeInfo.remoteAddress?.address?.hostAddress
        if (clientIp != null) {
            ipToSessionIds[clientIp]?.let { set ->
                set.remove(sessionId)
                if (set.isEmpty()) ipToSessionIds.remove(clientIp)
            }
        }
        unitToSessionIds.values.forEach { set -> set.remove(sessionId) }
        log.info("[WebSocket] 세션 제거: sessionId=$sessionId, ip=$clientIp, 현재 연결 수=${sessions.size}")
    }

    /** 유닛 중지 시 해당 유닛의 모든 WebSocket 세션을 종료한다. */
    fun closeAllForUnit(unitId: String) {
        val sessionIds = unitToSessionIds.remove(unitId) ?: return
        sessionIds.forEach { sessionId ->
            sessions.remove(sessionId)?.let { session ->
                if (session.isOpen) scope.launch { session.close().awaitFirstOrNull() }
            }
        }
    }

    fun send(sessionId: String, data: ByteArray): Mono<Void> {
        val session = sessions[sessionId]
            ?: return Mono.error(IllegalStateException("WebSocket 세션 없음: sessionId=$sessionId"))
        return session.send(Mono.just(session.textMessage(String(data, Charsets.UTF_8))))
    }

    /**
     * IP 주소로 해당 클라이언트의 모든 세션에 송신한다.
     * 동일 IP 복수 세션이 있으면 전부 전송하고, 개별 실패는 경고 후 무시한다.
     */
    fun sendByIp(ip: String, data: ByteArray): Mono<Void> {
        val sessionIds = ipToSessionIds[ip]
        if (sessionIds.isNullOrEmpty()) {
            return Mono.error(IllegalStateException("IP에 해당하는 세션 없음: ip=$ip"))
        }
        val sends = sessionIds.mapNotNull { sessionId ->
            sessions[sessionId]?.let { session ->
                session.send(Mono.just(session.textMessage(String(data, Charsets.UTF_8))))
                    .onErrorResume { e ->
                        log.warn("[WebSocket] 세션 송신 실패 무시 (sessionId=$sessionId): ${e.message}")
                        Mono.empty()
                    }
            }
        }
        if (sends.isEmpty()) return Mono.error(IllegalStateException("IP에 해당하는 활성 세션 없음: ip=$ip"))
        return Mono.`when`(sends)
    }

    /** 모니터링용: sessionId → isOpen */
    fun getAll(): Map<String, Boolean> = sessions.mapValues { (_, s) -> s.isOpen }

    /** 모니터링용: ip → Set<sessionId> */
    fun getIpMap(): Map<String, Set<String>> = ipToSessionIds.toMap()
}
