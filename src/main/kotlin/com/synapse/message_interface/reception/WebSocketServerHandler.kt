package com.synapse.message_interface.reception

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.workflow.WorkflowRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.web.reactive.socket.WebSocketHandler
import org.springframework.web.reactive.socket.WebSocketSession
import reactor.core.publisher.Mono
import java.util.concurrent.atomic.AtomicLong

class WebSocketServerHandler(
    private val registry: WorkflowRegistry,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: WebSocketSessionRegistry,
    private val referenceConfigService: ReferenceConfigService
) : WebSocketHandler {
    private val log = LoggerFactory.getLogger(javaClass)

    override fun handle(session: WebSocketSession): Mono<Void> {
        val path = session.handshakeInfo.uri.path

        val unit = registry.getAll().find { unit ->
            unit.nodes.any { node ->
                node.node0?.protocol == ProtocolType.WEBSOCKET_SERVER &&
                (node.node0.path ?: "/ws/${unit.id}") == path
            }
        }

        if (unit == null) {
            log.warn("[WebSocket Server] 등록된 유닛 없음: path=$path")
            return session.close()
        }

        val sessionId = sessionRegistry.register(session, unit.id)
        val clientIp = session.handshakeInfo.remoteAddress?.address?.hostAddress ?: ""
        log.info("[WebSocket Server] 새 연결: unitId=${unit.id}, sessionId=$sessionId, ip=$clientIp")

        @Suppress("UNCHECKED_CAST")
        val wsCfg = referenceConfigService.getConfig()["webSocketServer"] as? Map<String, Any?>
        val pingEnabled        = wsCfg?.get("pingEnabled")        as? Boolean ?: false
        val pingIntervalMs     = ((wsCfg?.get("pingIntervalSeconds") as? Number)?.toLong() ?: 30L) * 1000L
        val pongTimeoutMs      = ((wsCfg?.get("pongTimeoutSeconds")  as? Number)?.toLong() ?: 10L) * 1000L

        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val lastPongTime = AtomicLong(System.currentTimeMillis())

        val pingJob = if (pingEnabled) {
            scope.launch {
                while (session.isOpen) {
                    delay(pingIntervalMs)
                    if (!session.isOpen) break

                    val pingSentAt = System.currentTimeMillis()
                    try {
                        session.send(Mono.just(session.pingMessage { it.wrap(ByteArray(0)) }))
                            .awaitFirstOrNull()
                    } catch (e: Exception) {
                        log.warn("[WebSocket Server] Ping 전송 실패: unitId=${unit.id}, ${e.message}")
                        session.close().awaitFirstOrNull()
                        break
                    }

                    delay(pongTimeoutMs)
                    if (lastPongTime.get() < pingSentAt) {
                        log.warn("[WebSocket Server] Pong 미응답 (좀비 연결 감지), 강제 종료: unitId=${unit.id}, sessionId=${session.id}")
                        session.close().awaitFirstOrNull()
                        break
                    }
                }
            }
        } else null

        return session.receive()
            .doOnNext { msg ->
                if (msg.type.name.contains("PONG")) lastPongTime.set(System.currentTimeMillis())
            }
            .filter { !it.type.name.contains("PONG") }
            .flatMap { message ->
                val buf = message.payload
                val payload = ByteArray(buf.readableByteCount()).also { buf.read(it) }
                mono {
                    try {
                        val ctx = MessageContext(
                            rawBytes = payload,
                            endpoint = path,
                            protocol = "WEBSOCKET_SERVER",
                            metadata = mapOf("wsSessionId" to sessionId, "clientIp" to clientIp)
                        )
                        dispatcher.dispatch(ctx)
                    } catch (e: Exception) {
                        log.error("[WebSocket Server] 처리 오류: ${e.message}", e)
                    }
                }.then(Mono.empty())
            }
            .doFinally {
                pingJob?.cancel()
                scope.cancel()
                sessionRegistry.remove(sessionId)
            }
            .then()
    }
}
