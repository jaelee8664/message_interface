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
import reactor.netty.Connection
import reactor.netty.tcp.TcpClient

class TcpClientHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val connectionRegistry: TcpConnectionRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
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
                val connection: Connection = TcpClient.create()
                    .host(definition.host ?: "localhost")
                    .port(definition.port ?: 9091)
                    .connectNow()

                connectionRegistry.register(unit.id, connection)
                log.info("[TCP Client] 연결 성공: host=${definition.host}, port=${definition.port}")

                val pingJob = if (definition.pingEnabled) {
                    scope.launch {
                        while (running && !connection.isDisposed) {
                            delay(definition.pingIntervalSeconds * 1000L)
                            connection.outbound()
                                .sendByteArray(reactor.core.publisher.Mono.just("ping".toByteArray()))
                                .then()
                                .subscribe()
                        }
                    }
                } else null

                connection.inbound().receive()
                    .map { buf -> ByteArray(buf.readableBytes()).also { buf.readBytes(it) } }
                    .flatMap { payload ->
                        mono {
                            val ctx = MessageContext(rawBytes = payload, protocol = "TCP_CLIENT")
                            dispatcher.dispatch(ctx)
                        }.onErrorResume { e ->
                            log.error("[TCP Client] 처리 오류: ${e.message}", e)
                            reactor.core.publisher.Mono.empty()
                        }
                    }
                    .doFinally {
                        pingJob?.cancel()
                        connectionRegistry.remove(unit.id)
                    }
                    .then()
                    .block()
            } catch (e: Exception) {
                log.error("[TCP Client] 연결 실패: ${e.message}")
                connectionRegistry.remove(unit.id)
            }

            if (running && definition.reconnectEnabled) {
                log.info("[TCP Client] ${definition.reconnectDelaySeconds}초 후 재연결...")
                delay(definition.reconnectDelaySeconds * 1000L)
            } else break
        }
    }
}
