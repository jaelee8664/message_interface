package com.synapse.message_interface.deadletter

import com.synapse.message_interface.config.ReferenceConfigService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicReference

@Component
class DeadLetterStore(
    private val objectMapper: ObjectMapper,
    private val referenceConfigService: ReferenceConfigService
) : DisposableBean {

    companion object {
        const val DEFAULT_DIR = "dead-letters"
        const val DEFAULT_RETENTION_DAYS = 30L
        const val CHANNEL_CAPACITY = 10_000
        const val FLUSH_INTERVAL_MS = 1_000L
        const val MAX_MEMORY_ENTRIES = 1_000
    }

    private val log = LoggerFactory.getLogger(javaClass)
    private val channel = Channel<DeadLetterEntry>(capacity = CHANNEL_CAPACITY)
    private val recentEntries = ArrayDeque<DeadLetterEntry>()
    private val lock = Any()
    private val fileWriterRef = AtomicReference<DailyFileWriter?>(null)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        scope.launch { consumeEntries() }
        scope.launch { periodicFlush() }
    }

    // ── Config helpers ────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun deadLetterConfig(): Map<*, *>? =
        referenceConfigService.getConfig()["deadLetter"] as? Map<*, *>

    fun isEnabled(): Boolean = deadLetterConfig()?.get("enabled") as? Boolean ?: true

    fun getDirectory(): String = deadLetterConfig()?.get("directory") as? String ?: DEFAULT_DIR

    fun getRetentionDays(): Long =
        (deadLetterConfig()?.get("retentionDays") as? Number)?.toLong() ?: DEFAULT_RETENTION_DAYS

    // ── Public API ────────────────────────────────────────────────────────────

    /** Enqueues a dead letter entry for async write. No-op if disabled. */
    fun save(entry: DeadLetterEntry) {
        if (!isEnabled()) return
        channel.trySend(entry)
    }

    /**
     * Returns in-memory dead letter entries (newest first), up to [limit].
     * Optionally filters to entries within [days] days.
     */
    fun getRecent(limit: Int = 100, days: Int = 7): List<DeadLetterEntry> {
        val cutoff = Instant.now().minusSeconds(days * 86_400L)
        return synchronized(lock) { recentEntries.toList() }
            .filter { it.timestamp.isAfter(cutoff) }
            .sortedByDescending { it.timestamp }
            .take(limit)
    }

    /**
     * File-based search over [days] days of dead letter JSONL files.
     */
    suspend fun searchFromFiles(days: Int = 30, limit: Int = 500): List<DeadLetterEntry> =
        withContext(Dispatchers.IO) {
            val dir = File(getDirectory())
            if (!dir.exists()) return@withContext emptyList()
            val cutoff = LocalDate.now().minusDays(days.toLong())
            val results = mutableListOf<DeadLetterEntry>()

            dir.listFiles()
                ?.filter { f ->
                    f.name.startsWith("dead_") && f.name.endsWith(".jsonl") &&
                    runCatching {
                        val dateStr = f.name.removePrefix("dead_").removeSuffix(".jsonl")
                        !LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE).isBefore(cutoff)
                    }.getOrDefault(false)
                }
                ?.sortedByDescending { it.name }
                ?.forEach { file ->
                    if (results.size >= limit) return@forEach
                    file.bufferedReader(Charsets.UTF_8).use { reader ->
                        reader.lineSequence().forEach { line ->
                            if (results.size >= limit) return@forEach
                            runCatching {
                                results.add(objectMapper.readValue(line, DeadLetterEntry::class.java))
                            }
                        }
                    }
                }

            results.sortedByDescending { it.timestamp }
        }

    override fun destroy() {
        channel.close()
        scope.cancel()
    }

    // ── Background coroutines ─────────────────────────────────────────────────

    private suspend fun consumeEntries() {
        val dir = File(getDirectory()).also { it.mkdirs() }
        val writer = DailyFileWriter(dir).also { fileWriterRef.set(it) }
        try {
            for (entry in channel) {
                runCatching {
                    writer.write(objectMapper.writeValueAsString(entry))
                    synchronized(lock) {
                        recentEntries.addLast(entry)
                        if (recentEntries.size > MAX_MEMORY_ENTRIES) recentEntries.removeFirst()
                    }
                }.onFailure { log.warn("[DeadLetter] 파일 쓰기 실패: ${it.message}") }
            }
        } finally {
            fileWriterRef.set(null)
            writer.flush()
            writer.close()
        }
    }

    private suspend fun periodicFlush() {
        while (true) {
            delay(FLUSH_INTERVAL_MS)
            fileWriterRef.get()?.flush()
        }
    }

    // ── Retention ─────────────────────────────────────────────────────────────

    fun runRetention() {
        val dir = File(getDirectory())
        if (!dir.exists()) return
        val cutoff = LocalDate.now().minusDays(getRetentionDays())
        dir.listFiles()
            ?.filter { it.name.startsWith("dead_") && it.name.endsWith(".jsonl") }
            ?.forEach { file ->
                runCatching {
                    val dateStr = file.name.removePrefix("dead_").removeSuffix(".jsonl")
                    if (LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE).isBefore(cutoff)) {
                        file.delete()
                        log.info("[DeadLetter] 보존 기간 초과 파일 삭제: ${file.name}")
                    }
                }
            }
    }

    // ── Daily file writer ─────────────────────────────────────────────────────

    private inner class DailyFileWriter(private val dir: File) : AutoCloseable {
        private var currentDate: LocalDate = LocalDate.MIN
        private var writer: BufferedWriter? = null

        fun write(json: String) {
            val today = LocalDate.now()
            if (today != currentDate) {
                writer?.flush(); writer?.close()
                currentDate = today
                val file = File(dir, "dead_${today.format(DateTimeFormatter.ISO_LOCAL_DATE)}.jsonl")
                writer = FileWriter(file, true).buffered(65_536)
            }
            writer!!.write(json)
            writer!!.newLine()
        }

        fun flush() = writer?.flush()
        override fun close() { writer?.flush(); writer?.close() }
    }
}
