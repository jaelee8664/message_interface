package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.queue.MongoQueueService
import com.synapse.message_interface.reception.DynamicProtoUtil.buildDescriptor
import com.synapse.message_interface.reception.DynamicProtoUtil.toDynamicMessage
import com.synapse.message_interface.reception.GrpcClientRegistry
import com.synapse.message_interface.reception.GrpcSessionRegistry
import com.synapse.message_interface.reception.TcpClientConnectionPool
import com.synapse.message_interface.reception.TcpServerSessionRegistry
import com.synapse.message_interface.reception.WebSocketClientRegistry
import com.synapse.message_interface.reception.WebSocketSessionRegistry
import com.synapse.message_interface.sender.KafkaProducerPool
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.withTimeout
import org.apache.kafka.clients.producer.ProducerRecord
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient
import reactor.core.publisher.Mono
import java.net.URI

class Node4SendException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Component
class Node4Executor(
    private val parserRegistry: MessageParserRegistry,
    private val webClient: WebClient,
    private val webSocketSessionRegistry: WebSocketSessionRegistry,
    private val webSocketClientRegistry: WebSocketClientRegistry,
    private val tcpServerSessionRegistry: TcpServerSessionRegistry,
    private val tcpClientConnectionPool: TcpClientConnectionPool,
    private val kafkaProducerPool: KafkaProducerPool,
    private val mongoQueueService: MongoQueueService,
    private val grpcSessionRegistry: GrpcSessionRegistry,
    private val grpcClientRegistry: GrpcClientRegistry,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Serialize and send the output DTO to the target.
     * Returns response bytes if the protocol provides a response, otherwise null.
     * Applies timeout and retry as configured in [definition].
     *
     * gRPC 프로토콜: parserRegistry 를 거치지 않고 DynamicMessage 로 직접 직렬화.
     */
    suspend fun execute(data: Map<String, Any?>, definition: Node4Definition, context: MessageContext): ByteArray? {
        val mongoMessageId = context.traceId
        val def = definition.resolveSessionVars(context.sessionVars)

        return withRetry(def.retryCount, def.retryDelaySeconds, def.timeoutMs) {
            if (def.protocol == ProtocolType.GRPC_SERVER ||
                def.protocol == ProtocolType.GRPC_CLIENT) {
                sendViaGrpc(data, def, context)
                null
            } else {
                val serialized = parserRegistry.getParser(def.messageFormat)
                    .serialize(data, def.xmlRootElement)
                sendByProtocol(serialized, def, context, mongoMessageId)
            }
        }
    }

    private suspend fun sendByProtocol(serialized: ByteArray, definition: Node4Definition, context: MessageContext, mongoMessageId: String): ByteArray? =
        when (definition.protocol) {
            ProtocolType.REST_CLIENT -> sendViaRest(serialized, definition)

            ProtocolType.WEBSOCKET_CLIENT -> {
                sendViaWebSocketClient(serialized, definition)
                null
            }
            ProtocolType.WEBSOCKET_SERVER -> {
                sendViaWebSocketToExisting(serialized, definition, context)
                null
            }
            ProtocolType.TCP_CLIENT -> {
                sendViaTcpClient(serialized, definition)
                null
            }
            ProtocolType.TCP_SERVER -> {
                sendViaTcpToExisting(serialized, definition, context)
                null
            }
            ProtocolType.KAFKA_CONSUMER -> {
                throw Node4SendException("Kafka Consumer는 Node4 송신 프로토콜로 사용할 수 없습니다.")
            }
            ProtocolType.REST_SERVER -> {
                throw Node4SendException("REST Server는 Node4 송신 프로토콜로 사용할 수 없습니다.")
            }
            ProtocolType.KAFKA_PUBLISHER -> {
                sendViaKafkaPublisher(serialized, definition)
                null
            }
            ProtocolType.MONGO_QUEUE_PUBLISHER -> {
                sendViaMongoQueue(serialized, definition, mongoMessageId)
                null
            }
            ProtocolType.MONGO_QUEUE_CONSUMER -> {
                throw Node4SendException("MongoDB Queue Consumer는 Node4 송신 프로토콜로 사용할 수 없습니다.")
            }
            ProtocolType.GRPC_SERVER,
            ProtocolType.GRPC_CLIENT -> {
                // execute() 에서 gRPC 분기를 먼저 처리하므로 여기 도달하지 않음
                throw Node4SendException("gRPC 프로토콜은 별도 경로로 처리됩니다.")
            }
        }

    private suspend fun <T> withRetry(retryCount: Int, retryDelaySeconds: Int, timeoutMs: Long, block: suspend () -> T): T {
        var lastException: Exception? = null
        for (attempt in 0..retryCount) {
            try {
                return withTimeout(timeoutMs) { block() }
            } catch (e: TimeoutCancellationException) {
                lastException = Node4SendException("송신 타임아웃 (${timeoutMs}ms 초과)", e)
                if (attempt < retryCount) {
                    log.warn("[Node4] 재시도 ${attempt + 1}/$retryCount: 타임아웃")
                    if (retryDelaySeconds > 0) delay(retryDelaySeconds * 1000L)
                }
            } catch (e: CancellationException) {
                throw e  // propagate real coroutine cancellation
            } catch (e: Exception) {
                lastException = e
                if (attempt < retryCount) {
                    log.warn("[Node4] 재시도 ${attempt + 1}/$retryCount: ${e.message}")
                    if (retryDelaySeconds > 0) delay(retryDelaySeconds * 1000L)
                }
            }
        }
        throw lastException!!
    }

    // ── REST ──────────────────────────────────────────────────────────────────

    private suspend fun sendViaRest(data: ByteArray, definition: Node4Definition): ByteArray? {
        val url = buildUrl(definition.targetHost, definition.targetPort, definition.targetPath)
        return try {
            val contentType = when (definition.messageFormat) {
                MessageFormat.JSON -> "application/json"
                MessageFormat.XML -> "application/xml"
                MessageFormat.PROTOBUF -> "application/x-protobuf"
            }
            webClient.post()
                .uri(url)
                .header("Content-Type", contentType)
                .bodyValue(data)
                .retrieve()
                .bodyToMono(ByteArray::class.java)
                .awaitFirstOrNull()
        } catch (e: Exception) {
            throw Node4SendException("REST 송신 실패 ($url): ${e.message}", e)
        }
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────

    /**
     * Send via a persistent WebSocket client connection to the target.
     * Reuses an existing open session for the same host:port/path; connects on first use.
     */
    private suspend fun sendViaWebSocketClient(data: ByteArray, definition: Node4Definition) {
        val host = definition.targetHost ?: "localhost"
        val port = definition.targetPort ?: 80
        val path = definition.targetPath ?: "/"
        val key = "$host:$port$path"
        val uri = URI("ws://$host:$port$path")
        try {
            webSocketClientRegistry.getOrConnect(key, uri, definition.reconnectDelaySeconds)
            webSocketClientRegistry.send(key, data, definition.messageFormat)
        } catch (e: Exception) {
            throw Node4SendException("WebSocket 송신 실패 ($uri): ${e.message}", e)
        }
    }

    /**
     * Send to an already-connected WebSocket server session.
     * targetPath 기준:
     *  - null → 수신한 요청과 동일한 세션에 응답 (context.metadata["wsSessionId"] 사용)
     *  - IP 주소 → 해당 IP 클라이언트의 최신 세션에 송신
     */
    private suspend fun sendViaWebSocketToExisting(data: ByteArray, definition: Node4Definition, context: MessageContext) {
        val target = definition.targetPath
        try {
            if (target.isNullOrBlank()) {
                val sessionId = context.metadata["wsSessionId"] ?: return
                webSocketSessionRegistry.send(sessionId, data).awaitFirstOrNull()
            } else {
                webSocketSessionRegistry.sendByIp(target, data).awaitFirstOrNull()
            }
        } catch (e: Exception) {
            throw Node4SendException("WebSocket 세션 송신 실패 (target=$target): ${e.message}", e)
        }
    }

    // ── TCP ───────────────────────────────────────────────────────────────────

    /**
     * Send via a persistent TCP connection to the target.
     * Reuses an existing open connection for the same host:port; connects on first use.
     */
    private suspend fun sendViaTcpClient(data: ByteArray, definition: Node4Definition) {
        val host = definition.targetHost ?: "localhost"
        val port = definition.targetPort ?: 9091
        val key = "$host:$port"
        try {
            tcpClientConnectionPool.getOrConnect(
                key = key,
                host = host,
                port = port,
                reconnectDelaySeconds = definition.reconnectDelaySeconds
            )
            tcpClientConnectionPool.send(key, data)
        } catch (e: Exception) {
            throw Node4SendException("TCP 송신 실패 ($host:$port): ${e.message}", e)
        }
    }

    /**
     * Send to an already-connected TCP server session.
     * targetPath 기준:
     *  - null → 수신한 요청과 동일한 세션에 응답 (context.metadata["channelId"] 사용)
     *  - IP 주소 → 해당 IP 클라이언트의 모든 활성 채널에 송신
     */
    private fun sendViaTcpToExisting(data: ByteArray, definition: Node4Definition, context: MessageContext) {
        val target = definition.targetPath
        try {
            if (target.isNullOrBlank()) {
                val channelId = context.metadata["channelId"] ?: return
                tcpServerSessionRegistry.send(channelId, data)
            } else {
                tcpServerSessionRegistry.sendByIp(target, data)
            }
        } catch (e: Exception) {
            throw Node4SendException("TCP Server 세션 송신 실패 (target=$target): ${e.message}", e)
        }
    }

    // ── Kafka ─────────────────────────────────────────────────────────────────

    private suspend fun sendViaKafkaPublisher(data: ByteArray, definition: Node4Definition) {
        val topic = definition.targetTopic ?: throw Node4SendException("Kafka topic이 설정되지 않았습니다.")
        val bootstrapServers = definition.bootstrapServers ?: "localhost:9092"
        val producer = kafkaProducerPool.getOrCreate(bootstrapServers)
        try {
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
                producer.send(ProducerRecord(topic, data)) { _, ex ->
                    if (ex != null) cont.resumeWith(Result.failure(ex))
                    else cont.resumeWith(Result.success(Unit))
                }
            }
            log.debug("[Node4] Kafka 발행 완료: topic=$topic")
        } catch (e: Exception) {
            throw Node4SendException("Kafka 발행 실패 (topic=$topic): ${e.message}", e)
        }
    }

    // ── MongoDB Queue ─────────────────────────────────────────────────────────

    private suspend fun sendViaMongoQueue(data: ByteArray, definition: Node4Definition, messageId: String) {
        val queueName = definition.mongoQueueName
            ?: throw Node4SendException("mongoQueueName이 설정되지 않았습니다.")
        try {
            mongoQueueService.publish(queueName, data, messageId)
            log.debug("[Node4] MongoDB 큐 발행 완료: queueName=$queueName, messageId=$messageId")
        } catch (e: Exception) {
            throw Node4SendException("MongoDB 큐 발행 실패 (queueName=$queueName): ${e.message}", e)
        }
    }

    // ── gRPC ─────────────────────────────────────────────────────────────────

    /**
     * gRPC bidi stream 으로 메시지를 전송한다.
     *
     * GRPC_SERVER: context.metadata["grpcStreamId"] / ["unitId"] 로 세션을 찾아 응답.
     * GRPC_CLIENT: definition.targetHost:targetPort/serviceName/methodName 키로 연결된 스트림에 전송.
     */
    private suspend fun sendViaGrpc(data: Map<String, Any?>, definition: Node4Definition, context: MessageContext) {
        val schema = definition.protoSchema
            ?: throw Node4SendException("gRPC Node4 에 protoSchema 가 설정되지 않았습니다.")
        if (schema.isEmpty())
            throw Node4SendException("gRPC Node4 protoSchema 가 비어 있습니다.")

        val svcName     = definition.grpcServiceName ?: "MessageInterfaceService"
        val msgBaseName = svcName.substringAfterLast('.')
        val messages = definition.protoMessages.orEmpty()
        val descriptor = buildDescriptor("${msgBaseName}Response", schema, messages)
        val message = data.toDynamicMessage(descriptor)

        when (definition.protocol) {
            ProtocolType.GRPC_SERVER -> {
                val targetIp = definition.targetPath
                val unitId   = context.metadata["unitId"]
                    ?: throw Node4SendException("gRPC Server 응답: context 에 unitId 없음")
                if (!targetIp.isNullOrBlank()) {
                    // 대상 IP 기반 전송 — 해당 IP로 연결된 모든 gRPC 스트림에 전송
                    try {
                        grpcSessionRegistry.sendByIp(unitId, targetIp, message)
                    } catch (e: Exception) {
                        throw Node4SendException("gRPC Server IP 기반 전송 실패 (ip=$targetIp): ${e.message}", e)
                    }
                } else {
                    // 수신한 스트림에 응답 (기본 동작)
                    val streamId = context.metadata["grpcStreamId"]
                        ?: throw Node4SendException("gRPC Server 응답: context 에 grpcStreamId 없음")
                    try {
                        grpcSessionRegistry.send(unitId, streamId, message)
                    } catch (e: Exception) {
                        throw Node4SendException("gRPC Server 응답 실패 (streamId=$streamId): ${e.message}", e)
                    }
                }
            }
            ProtocolType.GRPC_CLIENT -> {
                val host    = definition.targetHost    ?: "localhost"
                val port    = definition.targetPort    ?: 9090
                val method  = definition.grpcMethodName ?: "BiStream"
                val key     = "$host:$port/$svcName/$method"
                // 스트림이 없으면 자동으로 연결 시작
                if (!grpcClientRegistry.isConnected(key)) {
                    log.info("[Node4] gRPC Client 미연결 → 자동 연결 시작: key=$key")
                    try {
                        grpcClientRegistry.getOrConnectForSendOnly(
                            key = key,
                            host = host,
                            port = port,
                            svcName = svcName,
                            methodName = method,
                            requestDescriptor = descriptor,
                            responseDescriptor = descriptor,
                            reconnectDelaySeconds = definition.reconnectDelaySeconds
                        )
                    } catch (e: Exception) {
                        throw Node4SendException("gRPC Client 연결 실패 (key=$key): ${e.message}", e)
                    }
                }
                try {
                    grpcClientRegistry.send(key, message)
                } catch (e: Exception) {
                    throw Node4SendException("gRPC Client 전송 실패 (key=$key): ${e.message}", e)
                }
            }
            else -> throw Node4SendException("sendViaGrpc: 잘못된 프로토콜 ${definition.protocol}")
        }
    }

    // ── Util ──────────────────────────────────────────────────────────────────

    private fun buildUrl(host: String?, port: Int?, path: String?): String {
        val h = host ?: "localhost"
        val p = port?.let { ":$it" } ?: ""
        val pa = path ?: "/"
        return "http://$h$p$pa"
    }

}

private val TEMPLATE_REGEX = Regex("""\$\{(\w+)\}""")

private fun String.resolveVars(vars: Map<String, String>): String =
    TEMPLATE_REGEX.replace(this) { vars[it.groupValues[1]] ?: it.value }

private fun Node4Definition.resolveSessionVars(vars: Map<String, String>): Node4Definition {
    if (vars.isEmpty()) return this
    // targetHostExpr 우선, 없으면 targetHost 자체의 ${...} 치환
    val resolvedHost = (targetHostExpr ?: targetHost)?.resolveVars(vars)
    val resolvedPort = targetPortExpr?.resolveVars(vars)?.toIntOrNull() ?: targetPort
    return copy(targetHost = resolvedHost, targetPort = resolvedPort)
}
