package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient
import reactor.core.publisher.Mono
import java.net.URI
import java.util.concurrent.atomic.AtomicLong

class WebSocketClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val clientRegistry: WebSocketClientRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val client = ReactorNettyWebSocketClient()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    @Volatile private var running = true

    fun start() {
        scope.launch { connectWithRetry() }
    }

    fun stop() {
        running = false
        scope.cancel()
    }

    private suspend fun connectWithRetry() {
        while (running) {
            try {
                val uri = URI("ws://${definition.host}:${definition.port}${definition.path ?: "/"}")
                log.info("[WebSocket Client] 연결 시도: $uri")

                val connKey = "${definition.host}:${definition.port}${definition.path ?: "/"}"
                client.execute(uri) { session ->
                    clientRegistry.registerHandlerSession(connKey, session)
                    log.info("[WebSocket Client] 연결 성공: unitId=${unit.id}")

                    val lastPongTime = AtomicLong(System.currentTimeMillis())

                    val pingJob = if (definition.pingEnabled) {
                        scope.launch {
                            while (running && session.isOpen) {
                                delay(definition.pingIntervalSeconds * 1000L)
                                if (!session.isOpen) break

                                val pingSentAt = System.currentTimeMillis()
                                try {
                                    session.send(Mono.just(session.pingMessage { it.wrap(ByteArray(0)) }))
                                        .awaitFirstOrNull()
                                } catch (e: Exception) {
                                    log.warn("[WebSocket Client] Ping 전송 실패: ${e.message}")
                                    session.close().awaitFirstOrNull()
                                    break
                                }

                                delay(definition.pongTimeoutSeconds * 1000L)
                                if (lastPongTime.get() < pingSentAt) {
                                    log.warn("[WebSocket Client] Pong 미응답 (좀비 연결 감지), 강제 종료: unitId=${unit.id}")
                                    session.close().awaitFirstOrNull()
                                    break
                                }
                            }
                        }
                    } else null

                    session.receive()
                        .doOnNext { msg ->
                            if (msg.type.name.contains("PONG")) lastPongTime.set(System.currentTimeMillis())
                        }
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
                            clientRegistry.removeHandlerSession(connKey)
                        }
                        .then()
                }.awaitFirstOrNull()
            } catch (e: Exception) {
                log.error("[WebSocket Client] 연결 실패: ${e.message}")
            }

            if (running) {
                log.info("[WebSocket Client] ${definition.reconnectDelaySeconds}초 후 재연결...")
                delay(definition.reconnectDelaySeconds * 1000L)
            } else {
                break
            }
        }
    }
}
