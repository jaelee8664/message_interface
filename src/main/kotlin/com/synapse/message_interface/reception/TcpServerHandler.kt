package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import kotlinx.coroutines.reactor.mono
import org.slf4j.LoggerFactory
import reactor.netty.DisposableServer
import reactor.netty.tcp.TcpServer

class TcpServerHandler(
    private val unit: WorkflowUnit,
    private val port: Int,
    private val dispatcher: WorkflowDispatcher,
    private val connectionRegistry: TcpConnectionRegistry
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private var server: DisposableServer? = null

    fun start() {
        server = TcpServer.create()
            .port(port)
            .handle { inbound, outbound ->
                inbound.receive()
                    .map { buf -> ByteArray(buf.readableBytes()).also { buf.readBytes(it) } }
                    .flatMap { payload ->
                        mono {
                            try {
                                val ctx = MessageContext(
                                    rawBytes = payload,
                                    protocol = "TCP_SERVER"
                                )
                                dispatcher.dispatch(ctx).body
                            } catch (e: Exception) {
                                log.error("[TCP Server] 처리 오류: ${e.message}", e)
                                null
                            }
                        }.flatMap { response ->
                            if (response != null && response.isNotEmpty()) outbound.sendByteArray(reactor.core.publisher.Mono.just(response)).then()
                            else reactor.core.publisher.Mono.empty()
                        }
                    }
                    .then()
            }
            .bindNow()
        log.info("[TCP Server] 시작: port=$port, unitId=${unit.id}")
    }

    fun stop() {
        server?.dispose()
        log.info("[TCP Server] 중지: unitId=${unit.id}")
    }
}
