package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.workflow.WorkflowRegistry
import io.netty.handler.timeout.IdleStateHandler
import org.springframework.boot.reactor.netty.NettyReactiveWebServerFactory
import org.springframework.boot.reactor.netty.NettyServerCustomizer
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.stereotype.Component
import java.util.concurrent.TimeUnit

@Component
class PortUnificationCustomizer(
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: TcpServerSessionRegistry,
    private val workflowRegistry: WorkflowRegistry
) : WebServerFactoryCustomizer<NettyReactiveWebServerFactory> {
    override fun customize(factory: NettyReactiveWebServerFactory) {
        factory.addServerCustomizers(NettyServerCustomizer { server ->
            server.doOnChannelInit { _, channel, _ ->
                val idleTimeoutSeconds = workflowRegistry.getAll()
                    .flatMap { it.nodes }
                    .mapNotNull { node -> node.node0?.takeIf { it.protocol == ProtocolType.TCP_SERVER } }
                    .mapNotNull { it.tcpIdleTimeoutSeconds }
                    .minOrNull()
                    ?: 60
                val pipeline = channel.pipeline()
                // protocol-detector를 먼저 추가한 뒤, idle handler를 그 앞에 삽입
                // → 연결 즉시(첫 메시지 전)부터 idle 타이머 시작; HTTP 연결은 protocol-detector에서 제거됨
                pipeline.addFirst("protocol-detector",
                    ProtocolDetectorHandler(dispatcher, sessionRegistry, idleTimeoutSeconds))
                if (idleTimeoutSeconds > 0) {
                    pipeline.addBefore("protocol-detector", "tcp-idle-state",
                        IdleStateHandler(idleTimeoutSeconds.toLong(), 0L, 0L, TimeUnit.SECONDS))
                }
            }
        })
    }
}
