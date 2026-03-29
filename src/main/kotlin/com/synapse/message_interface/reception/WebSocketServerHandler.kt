package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.workflow.WorkflowRegistry
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.web.reactive.socket.WebSocketHandler
import org.springframework.web.reactive.socket.WebSocketSession
import reactor.core.publisher.Mono

class WebSocketServerHandler(
    private val registry: WorkflowRegistry,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: WebSocketSessionRegistry
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

        sessionRegistry.register(unit.id, session)
        log.info("[WebSocket Server] 새 연결: unitId=${unit.id}, sessionId=${session.id}")

        return session.receive()
            .flatMap { message ->
                val buf = message.payload
                val payload = ByteArray(buf.readableByteCount()).also { buf.read(it) }
                mono {
                    try {
                        val ctx = MessageContext(
                            rawBytes = payload,
                            endpoint = path,
                            protocol = "WEBSOCKET_SERVER"
                        )
                        dispatcher.dispatch(ctx)
                    } catch (e: Exception) {
                        log.error("[WebSocket Server] 처리 오류: ${e.message}", e)
                    }
                }.then(Mono.empty())
            }
            .doFinally { sessionRegistry.remove(unit.id) }
            .then()
    }
}
