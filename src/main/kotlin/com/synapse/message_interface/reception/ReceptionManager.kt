package com.synapse.message_interface.reception

import com.google.protobuf.Descriptors
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.domain.node.Node1Definition
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.reception.DynamicProtoUtil.buildDescriptor
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
    private val webSocketClientRegistry: WebSocketClientRegistry,
    private val connectionRegistry: TcpConnectionRegistry,
    private val tcpClientConnectionPool: TcpClientConnectionPool,
    private val tcpServerSessionRegistry: TcpServerSessionRegistry,
    private val grpcSessionRegistry: GrpcSessionRegistry,
    private val grpcClientRegistry: GrpcClientRegistry,
    private val grpcServerManager: GrpcServerManager,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val activeHandlers = ConcurrentHashMap<String, Any>() // unitId → handler

    @Bean
    fun webSocketHandlerAdapter() = WebSocketHandlerAdapter()

    @Bean
    fun webSocketHandlerMapping(): HandlerMapping {
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
        // 모든 GRPC_SERVER 핸들러가 등록된 후 서버를 한 번에 시작
        grpcServerManager.startAll()
    }

    fun startHandlers(unit: WorkflowUnit) {
        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0 ?: return
        when (node0.protocol) {
            ProtocolType.WEBSOCKET_CLIENT -> {
                val handler = WebSocketClientHandler(unit, node0, dispatcher, webSocketClientRegistry)
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] WebSocket Client 시작: unitId={}", unit.id)
            }
            ProtocolType.TCP_CLIENT -> {
                val handler = TcpClientHandler(unit, node0, dispatcher, connectionRegistry, tcpClientConnectionPool)
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] TCP Client 시작: unitId={}", unit.id)
            }
            ProtocolType.KAFKA_CONSUMER -> {
                if (node0.topic.isNullOrBlank()) {
                    log.warn("[ReceptionManager] Kafka Consumer topic 미설정 - 핸들러 시작 건너뜀: unitId={}", unit.id)
                    return
                }
                val handler = KafkaConsumerHandler(unit, node0, dispatcher, node0.bootstrapServers ?: "localhost:9092")
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] Kafka Consumer 시작: unitId={}", unit.id)
            }
            ProtocolType.GRPC_SERVER -> {
                val (requestDesc, responseDesc) = buildGrpcDescriptors(unit, node0)
                    ?: run {
                        log.error("[ReceptionManager] gRPC 서버 설정 실패: protoSchema 없음 unitId={}", unit.id)
                        return
                    }
                val handler = GrpcServerHandler(
                    unit, node0, dispatcher, grpcSessionRegistry, requestDesc, responseDesc
                )
                grpcServerManager.registerUnit(unit.id, handler)
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] gRPC Server 등록: unitId={}", unit.id)
            }
            ProtocolType.GRPC_CLIENT -> {
                val (requestDesc, responseDesc) = buildGrpcDescriptors(unit, node0)
                    ?: run {
                        log.error("[ReceptionManager] gRPC 클라이언트 설정 실패: protoSchema 없음 unitId={}", unit.id)
                        return
                    }
                val handler = GrpcClientHandler(
                    unit, node0, dispatcher, grpcClientRegistry, requestDesc, responseDesc
                )
                handler.start()
                activeHandlers[unit.id] = handler
                log.info("[ReceptionManager] gRPC Client 시작: unitId={}, key={}", unit.id, handler.connKey)
            }
            ProtocolType.TCP_SERVER,
            ProtocolType.WEBSOCKET_SERVER,
            ProtocolType.REST_SERVER -> {
                log.info("[ReceptionManager] 서버 프로토콜 등록 완료: {}, unitId={}", node0.protocol, unit.id)
            }
            ProtocolType.MONGO_QUEUE_CONSUMER -> {
                log.info("[ReceptionManager] MongoDB 큐 소비 등록 완료: path={}, queue={}, unitId={}",
                    node0.path, node0.mongoQueueName, unit.id)
            }
            ProtocolType.KAFKA_PUBLISHER,
            ProtocolType.REST_CLIENT,
            ProtocolType.MONGO_QUEUE_PUBLISHER -> {
                log.info("[ReceptionManager] {}는 Node4 송신 전용입니다. Node0에서 사용 불가: unitId={}", node0.protocol, unit.id)
            }
        }
    }

    fun stopHandlers(unitId: String) {
        when (val handler = activeHandlers.remove(unitId)) {
            is WebSocketClientHandler -> handler.stop()
            is TcpClientHandler       -> handler.stop()
            is KafkaConsumerHandler   -> handler.stop()
            is GrpcClientHandler      -> handler.stop()
            is GrpcServerHandler      -> {
                grpcServerManager.unregisterUnit(unitId)
                grpcServerManager.rebuildServer()
                grpcSessionRegistry.closeAllForUnit(unitId)
            }
        }
        // 서버 프로토콜 세션 정리 (unit 삭제 시)
        sessionRegistry.closeAllForUnit(unitId)
    }

    fun restartUnit(unit: WorkflowUnit) {
        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0
        stopHandlers(unit.id)

        if (node0?.protocol == ProtocolType.GRPC_SERVER) {
            // GRPC_SERVER 는 startHandlers 에서 registerUnit 만 하고,
            // rebuildServer 로 서버를 재시작해야 한다
            startHandlers(unit)
            grpcServerManager.rebuildServer()
        } else {
            startHandlers(unit)
        }
    }

    // ── gRPC Descriptor 빌드 헬퍼 ─────────────────────────────────────────────

    /**
     * 유닛에서 Node1(입력 스키마)과 Node4(출력 스키마)의 protoSchema 를 찾아
     * Descriptor 쌍을 반환한다.
     * Node4 protoSchema 가 없으면 Node1 스키마를 출력에도 재사용한다.
     * 둘 다 없으면 null 반환.
     */
    private fun buildGrpcDescriptors(
        unit: WorkflowUnit,
        node0: Node0Definition
    ): Pair<Descriptors.Descriptor, Descriptors.Descriptor>? {
        val node1 = unit.nodes.firstOrNull { it.nodeType.name == "NODE1" }?.node1
        val node4 = unit.nodes.firstOrNull { it.nodeType.name == "NODE4" }?.node4

        val node1Schema   = node1?.protoSchema?.takeIf { it.isNotEmpty() }
        val node1Messages = node1?.protoMessages.orEmpty()

        val node4Schema   = node4?.protoSchema?.takeIf { it.isNotEmpty() }
        val node4Messages = node4?.protoMessages.orEmpty()

        if (node1Schema == null) return null

        val svcName     = node0.grpcServiceName ?: "MessageInterfaceService"
        val msgBaseName = svcName.substringAfterLast('.')
        val reqDesc = buildDescriptor("${msgBaseName}Request",  node1Schema, node1Messages)
        val resDesc = if (node4Schema != null)
            buildDescriptor("${msgBaseName}Response", node4Schema, node4Messages)
        else reqDesc  // 출력 스키마 미설정 시 입력 스키마 재사용

        return reqDesc to resDesc
    }
}
