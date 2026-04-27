package com.synapse.message_interface.config

import jakarta.annotation.PostConstruct
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.data.mongodb.core.ReactiveMongoTemplate
import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicReference

@Service
class ReferenceConfigService(
    private val template: ReactiveMongoTemplate
) {
    private val log = LoggerFactory.getLogger(javaClass)

    companion object {
        const val COLLECTION = "reference_config"
        const val DOC_ID = "main"
    }

    private val cache = AtomicReference<Map<String, Any?>>(emptyMap())

    @PostConstruct
    fun init() {
        runBlocking {
            val existing = loadFromMongo()
            if (existing == null) {
                val defaults = loadDefaults()
                saveToMongo(defaults)
                cache.set(defaults)
                log.info("[ReferenceConfig] MongoDB에 기본값을 시드했습니다.")
            } else {
                val merged = mergeDefaults(loadDefaults(), existing)
                if (merged != existing) saveToMongo(merged)
                cache.set(merged)
                log.info("[ReferenceConfig] MongoDB에서 설정을 로드했습니다.")
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun mergeDefaults(defaults: Map<String, Any?>, existing: Map<String, Any?>): Map<String, Any?> {
        val result = defaults.toMutableMap()
        for ((key, existingVal) in existing) {
            val defaultVal = defaults[key]
            result[key] = if (defaultVal is Map<*, *> && existingVal is Map<*, *>)
                mergeDefaults(defaultVal as Map<String, Any?>, existingVal as Map<String, Any?>)
            else
                existingVal
        }
        return result
    }

    fun getConfig(): Map<String, Any?> = cache.get()

    fun saveConfig(data: Map<String, Any?>) {
        runBlocking { saveToMongo(data) }
        cache.set(data)
    }

    // ── MongoDB I/O ───────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private suspend fun loadFromMongo(): Map<String, Any?>? {
        val doc = template.findById(DOC_ID, org.bson.Document::class.java, COLLECTION)
            .awaitFirstOrNull() ?: return null
        return doc.toMap().filterKeys { it != "_id" } as Map<String, Any?>
    }

    private suspend fun saveToMongo(data: Map<String, Any?>) {
        val doc = org.bson.Document(data).append("_id", DOC_ID)
        template.save(doc, COLLECTION).awaitFirstOrNull()
    }

    // ── Seed defaults ─────────────────────────────────────────────────────────

    private fun loadDefaults(): Map<String, Any?> = mapOf(
        "log" to mapOf(
            "retentionDays" to 7,
            "maxSizeGb" to 10,
            "directory" to "message-logs",
            "cleanupIntervalHours" to 24
        ),
        "history" to mapOf(
            "maxVersions" to 10
        ),
        "deadLetter" to mapOf(
            "enabled" to true,
            "retentionDays" to 30,
            "directory" to "dead-letters",
            "cleanupIntervalHours" to 24
        ),
        "mongoQueue" to mapOf(
            "doneRetentionHours" to 24,
            "failedRetentionDays" to 7,
            "cleanupIntervalMinutes" to 60
        ),
        "llm" to mapOf(
            "enabled" to false,
            "ollamaBaseUrl" to "http://localhost:11434",
            "codeModel" to "qwen2.5-coder:7b",
            "chatModel" to "llama3.2:3b",
            "timeoutSeconds" to 60
        ),
        "grpcServer" to mapOf(
            "keepAliveEnabled" to false,
            "keepAliveIntervalSeconds" to 300,
            "keepAliveTimeoutSeconds" to 20,
            "permitKeepAliveTime" to 300,
            "permitKeepAliveWithoutCalls" to true
        ),
        "tcpServer" to mapOf(
            "idleTimeoutSeconds" to 60
        ),
        "webSocketServer" to mapOf(
            "pingEnabled" to false,
            "pingIntervalSeconds" to 30,
            "pongTimeoutSeconds" to 10
        )
    )
}
