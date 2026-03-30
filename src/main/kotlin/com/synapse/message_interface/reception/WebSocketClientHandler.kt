package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient
import reactor.core.publisher.Mono
import java.net.URI

class WebSocketClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: WebSocketSessionRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val client = ReactorNettyWebSocketClient()
    private val scope = CoroutineScope(Dispatchers.IO)
    @Volatile private var running = true

    fun start() {
        scope.launch { connectWithRetry() }
    }

    fun stop() {
        running = false
    }

    private suspend fun connectWithRetry() {
        while (running) {
            try {
                val uri = URI("ws://${definition.host}:${definition.port}${definition.path ?: "/"}")
                log.info("[WebSocket Client] 연결 시도: $uri")

                client.execute(uri) { session ->
                    sessionRegistry.register(unit.id, session)
                    log.info("[WebSocket Client] 연결 성공: unitId=${unit.id}")

                    val pingJob = if (definition.pingEnabled) {
                        scope.launch {
                            while (running && session.isOpen) {
                                delay(definition.pingIntervalSeconds * 1000L)
                                session.send(Mono.just(session.pingMessage { it.wrap("ping".toByteArray()) }))
                                    .doOnError { e ->
                                        log.warn("[WebSocket Client] Ping 실패, 연결 종료: ${e.message}")
                                        session.close().subscribe()
                                    }
                                    .subscribe()
                            }
                        }
                    } else null

                    session.receive()
                        .filter { !it.type.name.contains("PONG") }
                        .flatMap { message ->
                            val buf = message.payload
                            val payload = ByteArray(buf.readableByteCount()).also { buf.read(it) }
                            mono {
                                val ctx = MessageContext(
                                    rawBytes = payload,
                                    endpoint = definition.path ?: "/",
                                    protocol = "WEBSOCKET_CLIENT"
                                )
                                dispatcher.dispatch(ctx)
                            }.onErrorResume { e ->
                                log.error("[WebSocket Client] 처리 오류: ${e.message}", e)
                                Mono.empty()
                            }
                        }
                        .doFinally {
                            pingJob?.cancel()
                            sessionRegistry.remove(unit.id)
                        }
                        .then()
                }.block()
            } catch (e: Exception) {
                log.error("[WebSocket Client] 연결 실패: ${e.message}")
            }

            if (running && definition.reconnectEnabled) {
                log.info("[WebSocket Client] ${definition.reconnectDelaySeconds}초 후 재연결...")
                delay(definition.reconnectDelaySeconds * 1000L)
            } else {
                break
            }
        }
    }
}
