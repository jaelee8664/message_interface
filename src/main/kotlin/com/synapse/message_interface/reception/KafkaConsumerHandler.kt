package com.synapse.message_interface.reception

import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.domain.node.Node0Definition
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.WorkflowDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.apache.kafka.clients.consumer.ConsumerConfig
import org.apache.kafka.clients.consumer.KafkaConsumer
import org.apache.kafka.common.serialization.ByteArrayDeserializer
import org.apache.kafka.common.serialization.StringDeserializer
import org.slf4j.LoggerFactory
import java.time.Duration

class KafkaConsumerHandler(
    private val unit: WorkflowUnit,
    private val definition: Node0Definition,
    private val dispatcher: WorkflowDispatcher,
    private val bootstrapServers: String
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    @Volatile private var running = true

    fun start() {
        val props = mapOf(
            ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG to bootstrapServers,
            ConsumerConfig.GROUP_ID_CONFIG to (definition.groupId ?: "message-interface-${unit.id}"),
            ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG to StringDeserializer::class.java.name,
            ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG to ByteArrayDeserializer::class.java.name,
            ConsumerConfig.AUTO_OFFSET_RESET_CONFIG to "latest",
            ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG to "false"
        )

        val topic = definition.topic ?: error("Kafka topic이 설정되지 않았습니다.")
        val consumer = KafkaConsumer<String, ByteArray>(props)
        consumer.subscribe(listOf(topic))

        scope.launch {
            consumer.use { c ->
                while (running) {
                    val records = c.poll(Duration.ofMillis(500))
                    for (record in records) {
                        if (!running) break
                        try {
                            val ctx = MessageContext(
                                rawBytes = record.value(),
                                protocol = "KAFKA_CONSUMER",
                                metadata = mapOf(
                                    "topic" to record.topic(),
                                    "partition" to record.partition().toString(),
                                    "offset" to record.offset().toString()
                                )
                            )
                            dispatcher.dispatch(ctx)
                        } catch (e: Exception) {
                            log.error("[Kafka Consumer] 처리 오류: ${e.message}", e)
                        }
                    }
                    if (!records.isEmpty) {
                        try {
                            c.commitSync()
                        } catch (e: Exception) {
                            log.error("[Kafka Consumer] Offset commit 실패, 루프 재시도: ${e.message}", e)
                        }
                    }
                }
            }
        }
        log.info("[Kafka Consumer] 시작: topic=${definition.topic}, groupId=${definition.groupId}")
    }

    fun stop() {
        running = false
        scope.cancel()
        log.info("[Kafka Consumer] 중지: unitId=${unit.id}")
    }
}
