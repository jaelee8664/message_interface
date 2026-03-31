package com.synapse.message_interface.sender

import org.apache.kafka.clients.producer.KafkaProducer
import org.apache.kafka.clients.producer.ProducerConfig
import org.apache.kafka.common.serialization.ByteArraySerializer
import org.apache.kafka.common.serialization.StringSerializer
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/**
 * Maintains a pool of KafkaProducer instances keyed by bootstrapServers string.
 * Producers are created lazily on first use and reused across all Node4 sends,
 * eliminating per-message producer creation/teardown overhead.
 */
@Component
class KafkaProducerPool : DisposableBean {
    private val log = LoggerFactory.getLogger(javaClass)
    private val producers = ConcurrentHashMap<String, KafkaProducer<String, ByteArray>>()

    fun getOrCreate(bootstrapServers: String): KafkaProducer<String, ByteArray> =
        producers.getOrPut(bootstrapServers) {
            log.info("[KafkaProducerPool] 새 Producer 생성: servers=$bootstrapServers")
            KafkaProducer(
                mapOf(
                    ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to bootstrapServers,
                    ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
                    ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to ByteArraySerializer::class.java
                )
            )
        }

    override fun destroy() {
        producers.values.forEach { runCatching { it.close() } }
        producers.clear()
        log.info("[KafkaProducerPool] 모든 Producer 종료 완료")
    }
}
