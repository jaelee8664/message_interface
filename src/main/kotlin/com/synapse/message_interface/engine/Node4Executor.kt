package com.synapse.message_interface.engine

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.reception.GrpcClientRegistry
import com.synapse.message_interface.reception.TcpConnectionRegistry
import com.synapse.message_interface.reception.WebSocketSessionRegistry
import com.synapse.message_interface.proto.MessageRequest
import com.google.protobuf.ByteString
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.withTimeoutOrNull
import org.apache.kafka.clients.producer.ProducerConfig
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.common.serialization.ByteArraySerializer
import org.apache.kafka.common.serialization.StringSerializer
import org.slf4j.LoggerFactory
import org.apache.kafka.clients.producer.KafkaProducer
import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient
import reactor.core.publisher.Mono
import reactor.netty.tcp.TcpClient
import java.net.URI

class Node4SendException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

@Component
class Node4Executor(
    private val parserRegistry: MessageParserRegistry,
    private val webClient: WebClient,
    private val webSocketSessionRegistry: WebSocketSessionRegistry,
    private val tcpConnectionRegistry: TcpConnectionRegistry,
    private val grpcClientRegistry: GrpcClientRegistry,
    private val referenceConfigService: ReferenceConfigService
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Serialize and send the output DTO to the target.
     * Returns response bytes if the protocol provides a response, otherwise null.
     * Applies timeout and retry as configured in [definition].
     */
    suspend fun execute(data: Map<String, Any?>, definition: Node4Definition): ByteArray? {
        if (definition.messageFormat == MessageFormat.PROTOBUF &&
            definition.protocol !in listOf(ProtocolType.GRPC_CLIENT, ProtocolType.GRPC_SERVER)) {
            throw Node4SendException("Protobuf 형식은 gRPC 프로토콜만 지원합니다.")
        }

        val parser = parserRegistry.getParser(definition.messageFormat)
        val serialized = parser.serialize(data)

        return withRetry(definition.retryCount, definition.timeoutMs) {
            sendByProtocol(serialized, definition)
        }
    }

    private suspend fun sendByProtocol(serialized: ByteArray, definition: Node4Definition): ByteArray? =
        when (definition.protocol) {
            ProtocolType.REST_SERVER -> sendViaRest(serialized, definition)

            ProtocolType.WEBSOCKET_CLIENT -> {
                sendViaWebSocketClient(serialized, definition)
                null
            }
            ProtocolType.WEBSOCKET_SERVER -> {
                sendViaWebSocketToExisting(serialized, definition)
                null
            }
            ProtocolType.TCP_CLIENT -> {
                sendViaTcpClient(serialized, definition)
                null
            }
            ProtocolType.TCP_SERVER -> {
                sendViaTcpToExisting(serialized, definition)
                null
            }
            ProtocolType.KAFKA_CONSUMER -> {
                throw Node4SendException("Kafka Consumer는 Node4 송신 프로토콜로 사용할 수 없습니다.")
            }
            ProtocolType.KAFKA_PUBLISHER -> {
                sendViaKafkaPublisher(serialized, definition)
                null
            }
            ProtocolType.GRPC_CLIENT -> sendViaGrpcClient(serialized, definition)
            ProtocolType.GRPC_SERVER -> serialized  // gRPC server response: return serialized bytes
        }

    private suspend fun <T> withRetry(retryCount: Int, timeoutMs: Long, block: suspend () -> T): T {
        var lastException: Exception? = null
        for (attempt in 0..retryCount) {
            try {
                return withTimeoutOrNull(timeoutMs) { block() }
                    ?: throw Node4SendException("송신 타임아웃 (${timeoutMs}ms 초과)")
            } catch (e: CancellationException) {
                throw e  // propagate real coroutine cancellation
            } catch (e: Exception) {
                lastException = e
                if (attempt < retryCount) {
                    log.warn("[Node4] 재시도 ${attempt + 1}/$retryCount: ${e.message}")
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
     * Send via a new one-shot WebSocket client connection to the target.
     */
    private suspend fun sendViaWebSocketClient(data: ByteArray, definition: Node4Definition) {
        val uri = URI("ws://${definition.targetHost ?: "localhost"}:${definition.targetPort ?: 80}${definition.targetPath ?: "/"}")
        try {
            ReactorNettyWebSocketClient().execute(uri) { session ->
                session.send(Mono.just(session.binaryMessage { buf -> buf.wrap(data) }))
                    .then(session.close())
            }.awaitFirstOrNull()
        } catch (e: Exception) {
            throw Node4SendException("WebSocket 송신 실패 ($uri): ${e.message}", e)
        }
    }

    /**
     * Send to an already-connected WebSocket session (e.g. same unit's server session).
     * Uses the targetPath as lookup key if no unitId is available.
     */
    private fun sendViaWebSocketToExisting(data: ByteArray, definition: Node4Definition) {
        val key = definition.targetPath ?: return
        try {
            webSocketSessionRegistry.send(key, data).subscribe()
        } catch (e: Exception) {
            log.warn("[Node4] WebSocket 세션 송신 실패 (key=$key): ${e.message}")
        }
    }

    // ── TCP ───────────────────────────────────────────────────────────────────

    /**
     * Send via a new one-shot TCP connection to the target.
     */
    private suspend fun sendViaTcpClient(data: ByteArray, definition: Node4Definition) {
        val host = definition.targetHost ?: "localhost"
        val port = definition.targetPort ?: 9091
        try {
            val connection = TcpClient.create().host(host).port(port).connectNow()
            connection.outbound()
                .sendByteArray(Mono.just(data))
                .then()
                .doFinally { connection.dispose() }
                .awaitFirstOrNull()
        } catch (e: Exception) {
            throw Node4SendException("TCP 송신 실패 ($host:$port): ${e.message}", e)
        }
    }

    /**
     * Send to an already-connected TCP connection (server-side).
     */
    private fun sendViaTcpToExisting(data: ByteArray, definition: Node4Definition) {
        val key = definition.targetPath ?: return
        try {
            tcpConnectionRegistry.send(key, data)
        } catch (e: Exception) {
            log.warn("[Node4] TCP 연결 송신 실패 (key=$key): ${e.message}")
        }
    }

    // ── gRPC ─────────────────────────────────────────────────────────────────

    /**
     * Send via gRPC:
     * - If a bidirectional stream is open in GrpcClientRegistry → stream the request
     * - Otherwise → not supported (gRPC requires an established stream or connection)
     */
    private suspend fun sendViaGrpcClient(data: ByteArray, definition: Node4Definition): ByteArray? {
        val key = definition.targetPath ?: definition.targetHost ?: "default"
        return if (grpcClientRegistry.isConnected(key)) {
            try {
                val request = MessageRequest.newBuilder()
                    .setPayload(ByteString.copyFrom(data))
                    .setFormat(definition.messageFormat.name)
                    .build()
                grpcClientRegistry.send(key, request)
                null
            } catch (e: Exception) {
                throw Node4SendException("gRPC 스트림 송신 실패: ${e.message}", e)
            }
        } else {
            log.warn("[Node4] gRPC 클라이언트 스트림이 없습니다 (key=$key). 먼저 Node0 gRPC 클라이언트를 연결하세요.")
            null
        }
    }

    // ── Kafka ─────────────────────────────────────────────────────────────────

    private suspend fun sendViaKafkaPublisher(data: ByteArray, definition: Node4Definition) {
        val topic = definition.targetTopic ?: throw Node4SendException("Kafka topic이 설정되지 않았습니다.")
        val bootstrapServers = referenceConfigService.getKafkaBootstrapServers()
        val props = mapOf(
            ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to bootstrapServers,
            ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to ByteArraySerializer::class.java
        )
        val producer = KafkaProducer<String, ByteArray>(props)
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
        } finally {
            producer.close()
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
