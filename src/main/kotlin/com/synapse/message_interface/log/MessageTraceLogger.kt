package com.synapse.message_interface.log

import org.springframework.stereotype.Component
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentLinkedDeque
import tools.jackson.databind.ObjectMapper

@Component
class MessageTraceLogger(private val objectMapper: ObjectMapper) {
    companion object {
        const val LOG_DIR = "message-logs"
        const val MAX_SIZE_BYTES = 10L * 1024 * 1024 * 1024  // 10GB
        const val RETENTION_DAYS = 7L
    }

    // In-memory recent log buffer (last 1000 entries)
    private val recentLogs = ConcurrentLinkedDeque<TraceLog>()
    private val logDir = File(LOG_DIR).also { it.mkdirs() }

    fun log(traceLog: TraceLog) {
        // Write to daily log file
        val fileName = "trace_${LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)}.jsonl"
        File(logDir, fileName).appendText(objectMapper.writeValueAsString(traceLog) + "\n")

        // Update in-memory buffer
        recentLogs.addLast(traceLog)
        if (recentLogs.size > 1000) recentLogs.pollFirst()
    }

    /**
     * Search logs by field key-value within the in-memory buffer and recent files.
     */
    fun search(fieldKey: String, fieldValue: String, limit: Int = 100): List<TraceLog> {
        return recentLogs
            .filter { log -> log.messageSnippet[fieldKey]?.toString() == fieldValue }
            .sortedBy { it.timestamp }
            .take(limit)
    }

    /**
     * Search logs from files by date range.
     */
    fun searchFromFiles(fieldKey: String, fieldValue: String, days: Int = 7): List<TraceLog> {
        val results = mutableListOf<TraceLog>()
        val cutoff = LocalDate.now().minusDays(days.toLong())
        logDir.listFiles()
            ?.filter { f ->
                f.name.startsWith("trace_") && f.name.endsWith(".jsonl") &&
                runCatching {
                    val dateStr = f.name.removePrefix("trace_").removeSuffix(".jsonl")
                    LocalDate.parse(dateStr).isAfter(cutoff)
                }.getOrDefault(false)
            }
            ?.sortedBy { it.name }
            ?.forEach { file ->
                file.bufferedReader().lines().forEach { line ->
                    runCatching {
                        val log = objectMapper.readValue(line, TraceLog::class.java)
                        if (log.messageSnippet[fieldKey]?.toString() == fieldValue) {
                            results.add(log)
                        }
                    }
                }
            }
        return results.sortedBy { it.timestamp }
    }
}
