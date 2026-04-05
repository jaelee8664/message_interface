package com.synapse.message_interface.reception

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.web.reactive.HandlerMapping
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter
import org.springframework.web.server.ServerWebExchange
import reactor.core.publisher.Mono
import java.util.concurrent.ConcurrentHashMap

@Configuration
class ReceptionManager(
    private val registry: WorkflowRegistry,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: WebSocketSessionRegistry,
    private val connectionRegistry: TcpConnectionRegistry,
    private val referenceConfigService: ReferenceConfigService
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val activeHandlers = ConcurrentHashMap<String, Any>() // unitId → handler

    @Bean
    fun webSocketHandlerAdapter() = WebSocketHandlerAdapter()

    @Bean
    fun webSocketHandlerMapping(): HandlerMapping {
        // Only intercepts WebSocket upgrade requests — REST calls fall through unaffected
        val wsHandler = WebSocketServerHandler(registry, dispatcher, sessionRegistry)
        val mapping = object : SimpleUrlHandlerMapping() {
            override fun getHandlerInternal(exchange: ServerWebExchange): Mono<Any> {
                val upgrade = exchange.request.headers.getFirst("Upgrade")
                if (upgrade?.lowercase() != "websocket") return Mono.empty()
                return super.getHandlerInternal(exchange)
            }
        }
        mapping.urlMap = mapOf("/**" to wsHandler)
        mapping.order = -1
        return mapping
    }

    @Bean
    @Order(2)
    fun receptionManagerRunner() = ApplicationRunner {
        registry.getAll().forEach { unit -> startHandlers(unit) }
    }

    fun startHandlers(unit: WorkflowUnit) {
        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0 ?: return
        when (node0.protocol) {
            ProtocolType.WEBSOCKET_CLIENT -> {
                val handler = WebSocketClientHandler(unit, node0, dispatcher, sessionRegistry)
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] WebSocket Client 시작: unitId=${unit.id}")
            }
            ProtocolType.TCP_SERVER -> {
                // Port unification으로 8080에서 HTTP와 함께 처리됨 (PortUnificationCustomizer)
                log.info("[ReceptionManager] TCP Server 등록 완료: unitId=${unit.id}")
            }
            ProtocolType.TCP_CLIENT -> {
                val handler = TcpClientHandler(unit, node0, dispatcher, connectionRegistry)
                handler.start()
                activeHandlers[unit.id] = handler
            }
            ProtocolType.KAFKA_CONSUMER -> {
                val handler = KafkaConsumerHandler(unit, node0, dispatcher, referenceConfigService.getKafkaBootstrapServers())
                handler.start()
                activeHandlers[unit.id] = handler
            }
            ProtocolType.KAFKA_PUBLISHER -> {
                log.info("[ReceptionManager] KAFKA_PUBLISHER는 Node4 송신 전용 프로토콜입니다. Node0에서 사용 불가: unitId=${unit.id}")
            }
            ProtocolType.WEBSOCKET_SERVER, ProtocolType.REST_SERVER -> {
                // These are handled by Spring (WebSocketHandlerMapping / RestServerHandler)
                log.info("[ReceptionManager] 서버 프로토콜 등록 완료: ${node0.protocol}, unitId=${unit.id}")
            }
        }
    }

    fun stopHandlers(unitId: String) {
        when (val handler = activeHandlers.remove(unitId)) {
            is WebSocketClientHandler -> handler.stop()
            is TcpClientHandler -> handler.stop()
            is KafkaConsumerHandler -> handler.stop()
        }
    }

    fun restartUnit(unit: WorkflowUnit) {
        stopHandlers(unit.id)
        startHandlers(unit)
    }
}
