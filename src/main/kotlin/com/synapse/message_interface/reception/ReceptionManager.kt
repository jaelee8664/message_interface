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
import org.springframework.web.reactive.HandlerMapping
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter
import java.util.concurrent.ConcurrentHashMap

@Configuration
class ReceptionManager(
    private val registry: WorkflowRegistry,
    private val dispatcher: WorkflowDispatcher,
    private val sessionRegistry: WebSocketSessionRegistry,
    private val connectionRegistry: TcpConnectionRegistry,
    private val grpcClientRegistry: GrpcClientRegistry,
    private val referenceConfigService: ReferenceConfigService
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val activeHandlers = ConcurrentHashMap<String, Any>() // unitId → handler

    @Bean
    fun webSocketHandlerAdapter() = WebSocketHandlerAdapter()

    @Bean
    fun webSocketHandlerMapping(): HandlerMapping {
        // Single catch-all handler — unit lookup is done at connection time via registry
        val mapping = SimpleUrlHandlerMapping()
        mapping.urlMap = mapOf("/**" to WebSocketServerHandler(registry, dispatcher, sessionRegistry))
        mapping.order = 1
        return mapping
    }

    @Bean
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
                val handler = TcpServerHandler(unit, node0.port ?: 9091, dispatcher, connectionRegistry)
                handler.start()
                activeHandlers[unit.id] = handler
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
            ProtocolType.GRPC_SERVER -> {
                // gRPC server is handled by Spring gRPC via GrpcServerHandler (@GrpcService)
                log.info("[ReceptionManager] gRPC Server는 Spring gRPC로 관리: unitId=${unit.id}")
            }
            ProtocolType.GRPC_CLIENT -> {
                val handler = GrpcClientHandler(unit, node0, dispatcher, grpcClientRegistry)
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] gRPC Client 시작: unitId=${unit.id}")
            }
        }
    }

    fun stopHandlers(unitId: String) {
        when (val handler = activeHandlers.remove(unitId)) {
            is WebSocketClientHandler -> handler.stop()
            is TcpServerHandler -> handler.stop()
            is TcpClientHandler -> handler.stop()
            is KafkaConsumerHandler -> handler.stop()
            is GrpcClientHandler -> handler.stop()
        }
    }

    fun restartUnit(unit: WorkflowUnit) {
        stopHandlers(unit.id)
        startHandlers(unit)
    }
}
