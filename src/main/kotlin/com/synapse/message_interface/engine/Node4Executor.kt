package com.synapse.message_interface.engine

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.node.Node4Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.reception.TcpClientConnectionPool
import com.synapse.message_interface.reception.TcpConnectionRegistry
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
    private val tcpConnectionRegistry: TcpConnectionRegistry,
    private val tcpServerSessionRegistry: TcpServerSessionRegistry,
    private val tcpClientConnectionPool: TcpClientConnectionPool,
    private val kafkaProducerPool: KafkaProducerPool
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Serialize and send the output DTO to the target.
     * Returns response bytes if the protocol provides a response, otherwise null.
     * Applies timeout and retry as configured in [definition].
     */
    suspend fun execute(data: Map<String, Any?>, definition: Node4Definition, context: MessageContext): ByteArray? {
        val serialized = parserRegistry.getParser(definition.messageFormat).serialize(data)

        return withRetry(definition.retryCount, definition.retryDelaySeconds, definition.timeoutMs) {
            sendByProtocol(serialized, definition, context)
        }
    }

    private suspend fun sendByProtocol(serialized: ByteArray, definition: Node4Definition, context: MessageContext): ByteArray? =
        when (definition.protocol) {
            ProtocolType.REST_CLIENT -> sendViaRest(serialized, definition)

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
            webSocketClientRegistry.getOrConnect(key, uri, definition.reconnectEnabled, definition.reconnectDelaySeconds)
            webSocketClientRegistry.send(key, data, definition.messageFormat)
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
                reconnectEnabled = definition.reconnectEnabled,
                reconnectDelaySeconds = definition.reconnectDelaySeconds
            )
            tcpClientConnectionPool.send(key, data)
        } catch (e: Exception) {
            throw Node4SendException("TCP 송신 실패 ($host:$port): ${e.message}", e)
        }
    }

    /**
     * Send to an already-connected TCP server session (channelId-based).
     * channelId 우선순위:
     *  1. definition.targetPath에 명시된 값 (다른 특정 세션에 보낼 때)
     *  2. context.metadata["channelId"] — 수신한 요청과 동일한 세션에 응답할 때
     */
    private fun sendViaTcpToExisting(data: ByteArray, definition: Node4Definition, context: MessageContext) {
        val channelId = definition.targetPath ?: context.metadata["channelId"] ?: return
        try {
            tcpServerSessionRegistry.send(channelId, data)
        } catch (e: Exception) {
            log.warn("[Node4] TCP Server 세션 송신 실패 (channelId=$channelId): ${e.message}")
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

    // ── Util ──────────────────────────────────────────────────────────────────

    private fun buildUrl(host: String?, port: Int?, path: String?): String {
        val h = host ?: "localhost"
        val p = port?.let { ":$it" } ?: ""
        val pa = path ?: "/"
        return "http://$h$p$pa"
    }
}
