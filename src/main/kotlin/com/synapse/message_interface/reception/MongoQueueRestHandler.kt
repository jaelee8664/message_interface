package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import com.synapse.message_interface.queue.MongoQueueService
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.web.reactive.function.server.RouterFunction
import org.springframework.web.reactive.function.server.ServerRequest
import org.springframework.web.reactive.function.server.ServerResponse
import org.springframework.web.reactive.function.server.coRouter
import org.springframework.web.reactive.function.server.buildAndAwait
import org.springframework.web.reactive.function.server.bodyValueAndAwait
import java.util.UUID

/**
 * MONGO_QUEUE_CONSUMER NODE0 전용 GET 핸들러.
 *
 * 클라이언트가 GET {path}를 호출하면:
 *   1. 해당 경로에 매핑된 MONGO_QUEUE_CONSUMER 단위를 조회
 *   2. MongoDB 큐에서 가장 오래된 PENDING 메세지를 원자적으로 PROCESSING으로 전환하여 취득
 *   3. 취득한 payload를 rawBytes로 파이프라인 실행
 *   4. 성공 시 DONE, 실패 시 PENDING 복구 (retryCount 증가, 한계 초과 시 FAILED)
 *
 * coRouter를 사용하여 정적 파일 서빙과 충돌하지 않도록 함.
 * (predicate가 false이면 다음 HandlerMapping으로 넘어감)
 */
@Configuration
class MongoQueueRestHandler(
    private val registry: WorkflowRegistry,
    private val dispatcher: WorkflowDispatcher,
    private val mongoQueueService: MongoQueueService
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Bean
    fun mongoQueueRouterFunction(): RouterFunction<ServerResponse> = coRouter {
        GET("/**", ::isMongoQueuePath, ::handleDequeue)
    }

    /** predicate: 요청 경로에 해당하는 MONGO_QUEUE_CONSUMER 단위가 존재할 때만 이 핸들러가 처리 */
    private fun isMongoQueuePath(request: ServerRequest): Boolean {
        val path = request.requestPath().pathWithinApplication().value()
        val unit = findUnitForPath(path) ?: return false
        request.attributes()["mongoQueueUnit"] = unit
        return true
    }

    private suspend fun handleDequeue(request: ServerRequest): ServerResponse {
        val path = request.requestPath().pathWithinApplication().value()
        @Suppress("UNCHECKED_CAST")
        val unit = request.attributes()["mongoQueueUnit"] as? WorkflowUnit
            ?: return ServerResponse.notFound().buildAndAwait()

        val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }!!.node0!!
        val queueName = node0.mongoQueueName
            ?: return ServerResponse.badRequest()
                .bodyValueAndAwait("mongoQueueName이 설정되지 않았습니다.")

        val lockId = UUID.randomUUID().toString()
        val message = mongoQueueService.dequeue(queueName, lockId)
            ?: return ServerResponse.noContent().buildAndAwait() // 큐 비어있음 → 204

        return try {
            val ctx = MessageContext(
                rawBytes = message.payload,
                endpoint = path,
                protocol = "MONGO_QUEUE_CONSUMER",
                metadata = mapOf(
                    "messageId" to message.messageId,
                    "queueName" to queueName,
                    "publishedAt" to message.publishedAt.toString()
                )
            )
            val result = dispatcher.dispatch(ctx)
            mongoQueueService.markDone(message)

            val status = HttpStatus.resolve(result.httpStatus) ?: HttpStatus.OK
            ServerResponse.status(status)
                .header("X-Queue-Message-Id", message.messageId)
                .bodyValueAndAwait(result.body ?: ByteArray(0))
        } catch (e: Exception) {
            log.error("[MongoQueueConsumer] 처리 실패: messageId=${message.messageId}, path=$path: ${e.message}", e)
            val newRetryCount = message.retryCount + 1
            if (newRetryCount >= node0.mongoQueueMaxRetries) {
                mongoQueueService.markFailed(message)
            } else {
                mongoQueueService.resetPending(message, incrementRetry = true)
            }
            ServerResponse.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .bodyValueAndAwait(e.message?.toByteArray() ?: ByteArray(0))
        }
    }

    /** registry에서 해당 경로(path)와 MONGO_QUEUE_CONSUMER 프로토콜이 일치하는 단위를 조회 */
    private fun findUnitForPath(path: String) =
        registry.getAll().firstOrNull { unit ->
            val node0 = unit.nodes.find { it.nodeType.name == "NODE0" }?.node0
            node0?.protocol == ProtocolType.MONGO_QUEUE_CONSUMER && node0.path == path
        }
}
