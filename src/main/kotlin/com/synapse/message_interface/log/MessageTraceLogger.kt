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
import com.synapse.message_interface.engine.fieldStatus
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicReference

@Component
class MessageTraceLogger(private val objectMapper: ObjectMapper) : DisposableBean {

    companion object {
        const val LOG_DIR = "message-logs"
        const val MAX_MEMORY_ENTRIES = 10_000
        /** Minute buckets covering 24h (1440 minutes). */
        const val BUCKET_COUNT = 1440
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

    /** Per-minute bucket for a single unit. Slot index = (epochSecond / 60) % BUCKET_COUNT. */
    private data class MinuteBucket(
        var minuteEpoch: Long = -1L,
        var success: Long = 0L,
        var error: Long = 0L,
        var unitName: String = "",
        var lastActivity: Instant? = null
    )
    private val unitBuckets = java.util.concurrent.ConcurrentHashMap<String, Array<MinuteBucket>>()

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
        val success = traceLog.status == TraceStatus.SUCCESS
        val minuteEpoch = traceLog.timestamp.epochSecond / 60
        val index = (minuteEpoch % BUCKET_COUNT).toInt()
        val buckets = unitBuckets.computeIfAbsent(traceLog.workflowUnitId) { Array(BUCKET_COUNT) { MinuteBucket() } }
        synchronized(buckets) {
            val bucket = buckets[index]
            if (bucket.minuteEpoch == minuteEpoch) {
                if (success) bucket.success++ else bucket.error++
            } else {
                bucket.minuteEpoch = minuteEpoch
                bucket.success = if (success) 1L else 0L
                bucket.error = if (!success) 1L else 0L
            }
            bucket.unitName = traceLog.workflowUnitName
            if (bucket.lastActivity == null || traceLog.timestamp.isAfter(bucket.lastActivity)) {
                bucket.lastActivity = traceLog.timestamp
            }
        }
    }

    /**
     * Aggregates pipeline stats from minute buckets for the last [windowMinutes] minutes.
     * Returns per-unit counts grouped by (unitId, unitName).
     */
    fun getRecentStats(windowMinutes: Int = 60): List<UnitStat> {
        val nowMinuteEpoch = Instant.now().epochSecond / 60
        val cutoff = nowMinuteEpoch - windowMinutes
        return unitBuckets.mapNotNull { (unitId, buckets) ->
            var success = 0L
            var error = 0L
            var lastActivity: Instant? = null
            var unitName = ""
            synchronized(buckets) {
                for (bucket in buckets) {
                    if (bucket.minuteEpoch in (cutoff + 1)..nowMinuteEpoch) {
                        success += bucket.success
                        error += bucket.error
                        if (bucket.lastActivity != null &&
                            (lastActivity == null || bucket.lastActivity!!.isAfter(lastActivity))) {
                            lastActivity = bucket.lastActivity
                        }
                        if (bucket.unitName.isNotEmpty()) unitName = bucket.unitName
                    }
                }
            }
            if (success == 0L && error == 0L) null
            else UnitStat(unitId, unitName.ifEmpty { unitId }, success, error, lastActivity)
        }
    }

    data class UnitStat(
        val unitId: String,
        val unitName: String,
        val successCount: Long,
        val errorCount: Long,
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
     * Find all logs matching [filterGroups] (supports dot-notation like "header.trace_id"),
     * then return every log entry sharing those traceIds, grouped by traceId and ordered by time.
     *
     * [filterGroups]: each inner list is AND-ed; outer list is OR-ed.
     *   e.g. [[A=1, B=2], [C=3]] → (A=1 AND B=2) OR C=3
     * [fromDateStr]/[toDateStr]: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time).
     */
    suspend fun searchTraces(
        filterGroups: List<List<Pair<String, String>>>,
        fromFiles: Boolean,
        days: Int = 7,
        maxTraces: Int = 50,
        fromDateStr: String? = null,
        toDateStr: String? = null
    ): TraceSearchResult = withContext(Dispatchers.IO) {
        val zone = ZoneId.systemDefault()
        val dateFmt = DateTimeFormatter.ISO_LOCAL_DATE
        val dtFmt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

        fun parseInstant(s: String, endPeriod: Boolean): Instant {
            return if (s.contains('T')) {
                val ldt = LocalDateTime.parse(s.take(16), dtFmt)
                val inst = ldt.atZone(zone).toInstant()
                if (endPeriod) inst.plusSeconds(59) else inst
            } else {
                val d = LocalDate.parse(s, dateFmt)
                if (endPeriod) d.atTime(23, 59, 59).atZone(zone).toInstant()
                else d.atStartOfDay(zone).toInstant()
            }
        }

        val fromInstant = fromDateStr?.let { parseInstant(it, false) }
            ?: LocalDate.now().minusDays(days.toLong()).atStartOfDay(zone).toInstant()
        val toInstant = toDateStr?.let { parseInstant(it, true) }
            ?: LocalDate.now().atTime(23, 59, 59).atZone(zone).toInstant()
        val from = fromInstant.atZone(zone).toLocalDate()
        val to = toInstant.atZone(zone).toLocalDate()

        // Strip empty conditions, then empty groups
        val activeGroups = filterGroups
            .map { group -> group.filter { (k, v) -> k.isNotBlank() || v.isNotBlank() } }
            .filter { it.isNotEmpty() }
        val noFilter = activeGroups.isEmpty()
        val groupMaps = activeGroups.map { group -> group.map { mapOf("key" to it.first, "value" to it.second) } }

        val grouped = if (fromFiles) {
            val matchedTraceIds = if (noFilter) {
                collectFirstNTraceIds(from, to, fromInstant, toInstant, maxTraces)
            } else {
                collectMatchedTraceIds(from, to, fromInstant, toInstant, activeGroups)
            }
            if (matchedTraceIds.isEmpty()) return@withContext TraceSearchResult(groupMaps, emptyList())
            collectLogsByTraceIds(from, to, matchedTraceIds)
        } else {
            val allLogs = synchronized(lock) { recentLogs.toList() }
            val timeFiltered = allLogs.filter { !it.timestamp.isBefore(fromInstant) && !it.timestamp.isAfter(toInstant) }
            val matchedTraceIds = if (noFilter) {
                timeFiltered.map { it.traceId }.distinct().take(maxTraces).toSet()
            } else {
                timeFiltered
                    .filter { log -> matchesGroups(log.messageSnippet, activeGroups) }
                    .map { it.traceId }
                    .toSet()
            }
            allLogs.filter { it.traceId in matchedTraceIds }
        }
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

        TraceSearchResult(filterGroups = groupMaps, traces = grouped)
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
            val actual = FlatMessageAccessor.get(snippet, fieldKey)
            if (actual == fieldStatus.NOKEY) return@runCatching false

            // Value blank → existence check (key exists and is not null)
            if (fieldValue.isBlank()) return@runCatching actual != null

            val actualStr = actual?.toString() ?: return@runCatching false
            if (actualStr == fieldValue) return@runCatching true

            // Numeric fallback: handles Double "200.0" vs query "200", etc.
            val numActual = actualStr.toDoubleOrNull()
            val numQuery = fieldValue.toDoubleOrNull()
            numActual != null && numQuery != null && numActual == numQuery
        }.getOrDefault(false)
    }

    /** (A AND B) OR (C AND D) — each inner list is ANDed, outer list is ORed. */
    private fun matchesGroups(
        snippet: Map<String, Any?>,
        groups: List<List<Pair<String, String>>>
    ): Boolean {
        if (groups.isEmpty()) return true
        return groups.any { group -> group.all { (key, value) -> matchesField(snippet, key, value) } }
    }

    private fun targetFiles(fromDate: LocalDate, toDate: LocalDate): List<File> =
        (logDir.listFiles() ?: emptyArray())
            .filter { f ->
                f.name.startsWith("trace_") && f.name.endsWith(".jsonl") &&
                runCatching {
                    val dateStr = f.name.removePrefix("trace_").removeSuffix(".jsonl")
                    val fileDate = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
                    !fileDate.isBefore(fromDate) && !fileDate.isAfter(toDate)
                }.getOrDefault(false)
            }
            .sortedByDescending { it.name }

    /** Single-pass: collect the first [maxCount] unique traceIds in [fromInstant, toInstant] — exits early once limit is reached. */
    private fun collectFirstNTraceIds(
        fromDate: LocalDate, toDate: LocalDate,
        fromInstant: Instant, toInstant: Instant,
        maxCount: Int
    ): Set<String> {
        val traceIds = LinkedHashSet<String>()
        for (file in targetFiles(fromDate, toDate)) {
            if (traceIds.size >= maxCount) break
            file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                for (line in reader.lineSequence()) {
                    if (traceIds.size >= maxCount) break
                    runCatching { objectMapper.readValue(line, TraceLog::class.java) }
                        .onSuccess { log ->
                            if (!log.timestamp.isBefore(fromInstant) && !log.timestamp.isAfter(toInstant))
                                traceIds.add(log.traceId)
                        }
                }
            }
        }
        return traceIds
    }

    /** Pass 1: scan files and collect traceIds matching [filterGroups] within [fromInstant, toInstant]. */
    private fun collectMatchedTraceIds(
        fromDate: LocalDate, toDate: LocalDate,
        fromInstant: Instant, toInstant: Instant,
        filterGroups: List<List<Pair<String, String>>>
    ): Set<String> {
        val traceIds = mutableSetOf<String>()
        for (file in targetFiles(fromDate, toDate)) {
            file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                reader.lineSequence().forEach { line ->
                    runCatching {
                        val log = objectMapper.readValue(line, TraceLog::class.java)
                        if (!log.timestamp.isBefore(fromInstant) && !log.timestamp.isAfter(toInstant) &&
                            matchesGroups(log.messageSnippet, filterGroups)
                        ) {
                            traceIds.add(log.traceId)
                        }
                    }
                }
            }
        }
        return traceIds
    }

    /** Pass 2: scan files again and collect only logs belonging to matched traceIds. */
    private fun collectLogsByTraceIds(
        fromDate: LocalDate, toDate: LocalDate,
        traceIds: Set<String>
    ): List<TraceLog> {
        val results = mutableListOf<TraceLog>()
        for (file in targetFiles(fromDate, toDate)) {
            file.bufferedReader(Charsets.UTF_8, bufferSize = 65_536).use { reader ->
                reader.lineSequence().forEach { line ->
                    runCatching {
                        val log = objectMapper.readValue(line, TraceLog::class.java)
                        if (log.traceId in traceIds) results.add(log)
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
