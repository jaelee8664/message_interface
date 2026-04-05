package com.synapse.message_interface.reception

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.engine.WorkflowDispatcher
import org.springframework.boot.reactor.netty.NettyReactiveWebServerFactory
import org.springframework.boot.reactor.netty.NettyServerCustomizer
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.stereotype.Component

@Component
class PortUnificationCustomizer(
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: TcpServerSessionRegistry,
    private val referenceConfigService: ReferenceConfigService
) : WebServerFactoryCustomizer<NettyReactiveWebServerFactory> {
    override fun customize(factory: NettyReactiveWebServerFactory) {
        factory.addServerCustomizers(NettyServerCustomizer { server ->
            server.doOnChannelInit { _, channel, _ ->
                val idleTimeoutSeconds = referenceConfigService.getTcpServerIdleTimeoutSeconds()
                channel.pipeline().addFirst(
                    "protocol-detector",
                    ProtocolDetectorHandler(dispatcher, sessionRegistry, idleTimeoutSeconds)
                )
            }
        })
    }
}
