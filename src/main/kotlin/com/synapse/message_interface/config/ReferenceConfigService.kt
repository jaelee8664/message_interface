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
                cache.set(existing)
                log.info("[ReferenceConfig] MongoDB에서 설정을 로드했습니다.")
            }
        }
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
        )
    )
}
