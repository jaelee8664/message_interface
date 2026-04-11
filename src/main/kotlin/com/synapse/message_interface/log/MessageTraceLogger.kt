package com.synapse.message_interface.log

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.synapse.message_interface.engine.FlatMessageAccessor
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
class MessageTraceLogger(private val objectMapper: ObjectMapper) : DisposableBean {

    companion object {
        const val LOG_DIR = "message-logs"
        const val MAX_MEMORY_ENTRIES = 10_000
        /** Drop logs silently if the async channel is full (high-load protection). */
        const val CHANNEL_CAPACITY = 100_000
        /** Periodic flush interval in milliseconds — limits maximum log loss on crash. */
        const val FLUSH_INTERVAL_MS = 1_000L
    }

    private val logDir = File(LOG_DIR).also { it.mkdirs() }

    /** Single-producer / single-consumer channel — the background coroutine owns all file I/O. */
    private val channel = Channel<TraceLog>(capacity = CHANNEL_CAPACITY)

    /** Ring buffer for recent-log search (all reads/writes guarded by [lock]). */
    private val recentLogs = ArrayDeque<TraceLog>()
    private val lock = Any()

    /** Shared reference so the flush coroutine can reach the writer owned by the consumer coroutine. */
    private val fileWriterRef = AtomicReference<DailyFileWriter?>(null)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        scope.launch { consumeLogs() }
        scope.launch { periodicFlush() }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Fire-and-forget: enqueue a log entry for async file write. Never blocks. */
    fun log(traceLog: TraceLog) {
        channel.trySend(traceLog) // drops silently when channel is full (non-blocking)
    }

    /**
     * Aggregates pipeline stats from the in-memory log buffer for the last [windowMinutes] minutes.
     * Returns per-unit counts grouped by (unitId, unitName).
     */
    fun getRecentStats(windowMinutes: Int = 60): List<UnitStat> {
        val cutoff = Instant.now().minusSeconds(windowMinutes * 60L)
        val snapshot = synchronized(lock) { recentLogs.toList() }
        data class Acc(var success: Int = 0, var error: Int = 0, var lastActivity: Instant? = null)
        val map = LinkedHashMap<String, Acc>()
        for (log in snapshot) {
            if (log.timestamp.isBefore(cutoff)) continue
            val key = log.workflowUnitId
            val acc = map.getOrPut(key) { Acc() }
            if (log.status == TraceStatus.SUCCESS) acc.success++ else acc.error++
            if (acc.lastActivity == null || log.timestamp.isAfter(acc.lastActivity)) acc.lastActivity = log.timestamp
        }
        // Re-scan once to get unitName (last seen name per unitId)
        val names = mutableMapOf<String, String>()
        for (log in snapshot) { names[log.workflowUnitId] = log.workflowUnitName }
        return map.map { (unitId, acc) ->
            UnitStat(unitId, names[unitId] ?: unitId, acc.success, acc.error, acc.lastActivity)
        }
    }

    data class UnitStat(
        val unitId: String,
        val unitName: String,
        val successCount: Int,
        val errorCount: Int,
        val lastActivity: Instant?
    )

    /** Fast in-memory search over the last [MAX_MEMORY_ENTRIES] logs. */
    fun search(fieldKey: String, fieldValue: String, limit: Int = 100): List<TraceLog> {
        return synchronized(lock) { recentLogs.toList() }
            .filter { matchesField(it.messageSnippet, fieldKey, fieldValue) }
            .sortedByDescending { it.timestamp }
            .take(limit)
    }

    /**
     * Find all logs where [fieldKey] == [fieldValue] (supports dot-notation like "header.trace_id"),
     * then return every log entry sharing those traceIds, grouped by traceId and ordered by time.
     */
    suspend fun searchTraces(
        fieldKey: String,
        fieldValue: String,
        fromFiles: Boolean,
        days: Int = 7,
        maxTraces: Int = 50,
        fromDateStr: String? = null,
        toDateStr: String? = null
    ): TraceSearchResult = withContext(Dispatchers.IO) {
        val fmt = DateTimeFormatter.ISO_LOCAL_DATE
        val from = fromDateStr?.let { LocalDate.parse(it, fmt) } ?: LocalDate.now().minusDays(days.toLong())
        val to = toDateStr?.let { LocalDate.parse(it, fmt) } ?: LocalDate.now()

        val allLogs: List<TraceLog> = if (fromFiles) {
            collectAllFromFiles(from, to)
        } else {
            synchronized(lock) { recentLogs.toList() }
        }

        // Pass 1: find system traceIds that contain the searched field value
        val matchedTraceIds = allLogs
            .filter { log -> matchesField(log.messageSnippet, fieldKey, fieldValue) }
            .map { it.traceId }
            .toSet()

        // Pass 2: group all entries for matched traceIds by traceId, ordered by timestamp
        val grouped = allLogs
            .filter { it.traceId in matchedTraceIds }
            .groupBy { it.traceId }
            .map { (traceId, entries) ->
                val sorted = entries.sortedBy { it.timestamp }
                TraceEntry(
                    traceId = traceId,
                    firstSeen = sorted.first().timestamp,
                    workflowUnitName = sorted.first().workflowUnitName,
                    entries = sorted
                )
            }
            .sortedBy { it.firstSeen }
            .take(maxTraces)

        TraceSearchResult(fieldKey = fieldKey, fieldValue = fieldValue, traces = grouped)
    }

    /**
     * File-based search over [days] days of JSONL log files.
     * Runs on [Dispatchers.IO] — safe to call from a coroutine or suspend controller.
     */
    suspend fun searchFromFiles(
        fieldKey: String,
        fieldValue: String,
        days: Int = 7,
        limit: Int = 500
    ): List<TraceLog> = withContext(Dispatchers.IO) {
        val results = mutableListOf<TraceLog>()
        val cutoff = LocalDate.now().minusDays(days.toLong())

        logDir.listFiles()
            ?.filter { f ->
                f.name.startsWith("trace_") && f.name.endsWith(".jsonl") &&
                runCatching {
                    val dateStr = f.name.removePrefix("trace_").removeSuffix(".jsonl")
                    !LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE).isBefore(cutoff)
                }.getOrDefault(false)
            }
            ?.sortedByDescending { it.name } // newest first
            ?.forEach { file ->
                if (results.size >= limit) return@forEach
                file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                    reader.lineSequence().forEach { line ->
                        if (results.size >= limit) return@forEach
                        runCatching {
                            val log = objectMapper.readValue(line, TraceLog::class.java)
                            if (matchesField(log.messageSnippet, fieldKey, fieldValue)) {
                                results.add(log)
                            }
                        }
                    }
                }
            }

        results.sortedByDescending { it.timestamp }
    }

    /**
     * 지정된 시간 범위 [from, to) 내에서 NODE0 진입 로그만 조회한다.
     * unitIds에 포함된 유닛의 로그만 반환하며, 날짜 경계를 넘는 경우도 처리한다.
     */
    suspend fun fetchNode0LogsByTimeAndUnits(
        from: java.time.Instant,
        to: java.time.Instant,
        unitIds: Set<String>
    ): List<TraceLog> = withContext(Dispatchers.IO) {
        val fromDate = from.atZone(java.time.ZoneOffset.UTC).toLocalDate()
        val toDate = to.atZone(java.time.ZoneOffset.UTC).toLocalDate()

        val results = mutableListOf<TraceLog>()
        var date = fromDate
        while (!date.isAfter(toDate)) {
            val file = File(logDir, "trace_${date.format(DateTimeFormatter.ISO_LOCAL_DATE)}.jsonl")
            if (file.exists()) {
                file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                    reader.lineSequence().forEach { line ->
                        runCatching {
                            val log = objectMapper.readValue(line, TraceLog::class.java)
                            if (log.nodeType == "NODE0" &&
                                log.workflowUnitId in unitIds &&
                                !log.timestamp.isBefore(from) &&
                                log.timestamp.isBefore(to)
                            ) {
                                results.add(log)
                            }
                        }
                    }
                }
            }
            date = date.plusDays(1)
        }
        results.sortedBy { it.timestamp }
    }

    override fun destroy() {
        channel.close()
        scope.cancel()
    }

    // ── Background coroutines ─────────────────────────────────────────────────

    private suspend fun consumeLogs() {
        val fileWriter = DailyFileWriter().also { fileWriterRef.set(it) }
        try {
            for (log in channel) {
                val json = objectMapper.writeValueAsString(log)
                fileWriter.write(json)
                synchronized(lock) {
                    recentLogs.addLast(log)
                    if (recentLogs.size > MAX_MEMORY_ENTRIES) recentLogs.removeFirst()
                }
            }
        } finally {
            fileWriterRef.set(null)
            fileWriter.flush()
            fileWriter.close()
        }
    }

    /** Flushes the writer to disk every second — caps crash loss to at most 1 second of logs. */
    private suspend fun periodicFlush() {
        while (true) {
            delay(FLUSH_INTERVAL_MS)
            fileWriterRef.get()?.flush()
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun matchesField(snippet: Map<String, Any?>, fieldKey: String, fieldValue: String): Boolean {
        return runCatching {
            FlatMessageAccessor.get(snippet, fieldKey)?.toString() == fieldValue
        }.getOrDefault(false)
    }

    private fun collectAllFromFiles(fromDate: LocalDate, toDate: LocalDate): List<TraceLog> {
        val results = mutableListOf<TraceLog>()
        logDir.listFiles()
            ?.filter { f ->
                f.name.startsWith("trace_") && f.name.endsWith(".jsonl") &&
                runCatching {
                    val dateStr = f.name.removePrefix("trace_").removeSuffix(".jsonl")
                    val fileDate = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
                    !fileDate.isBefore(fromDate) && !fileDate.isAfter(toDate)
                }.getOrDefault(false)
            }
            ?.sortedByDescending { it.name }
            ?.forEach { file ->
                file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                    reader.lineSequence().forEach { line ->
                        runCatching {
                            results.add(objectMapper.readValue(line, TraceLog::class.java))
                        }
                    }
                }
            }
        return results
    }

    // ── Daily file writer (append mode, buffered) ─────────────────────────────

    private inner class DailyFileWriter : AutoCloseable {
        private var currentDate: LocalDate = LocalDate.MIN
        private var writer: BufferedWriter? = null

        fun write(json: String) {
            val today = LocalDate.now()
            if (today != currentDate) {
                writer?.flush()
                writer?.close()
                currentDate = today
                val file = File(logDir, "trace_${today.format(DateTimeFormatter.ISO_LOCAL_DATE)}.jsonl")
                writer = FileWriter(file, true).buffered(65_536)
            }
            writer!!.write(json)
            writer!!.newLine()
        }

        fun flush() = writer?.flush()

        override fun close() {
            writer?.flush()
            writer?.close()
        }
    }
}
