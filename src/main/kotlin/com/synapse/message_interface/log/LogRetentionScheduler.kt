package com.synapse.message_interface.log

import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Component
class LogRetentionScheduler {
    companion object {
        const val LOG_DIR = "message-logs"
        const val MAX_SIZE_BYTES = 10L * 1024 * 1024 * 1024  // 10GB
        const val RETENTION_DAYS = 7L
    }

    private val logDir = File(LOG_DIR).also { it.mkdirs() }

    @Scheduled(cron = "0 0 3 * * *") // Every day at 3 AM
    fun cleanup() {
        val cutoff = LocalDate.now().minusDays(RETENTION_DAYS)
        val allFiles = logDir.listFiles()
            ?.filter { it.name.startsWith("trace_") && it.name.endsWith(".jsonl") }
            ?.sortedBy { it.name }
            ?: return

        // Delete files older than 7 days
        allFiles.forEach { file ->
            runCatching {
                val dateStr = file.name.removePrefix("trace_").removeSuffix(".jsonl")
                val fileDate = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
                if (fileDate.isBefore(cutoff)) file.delete()
            }
        }

        // If total size > 10GB, delete oldest until under limit
        val remainingFiles = logDir.listFiles()
            ?.filter { it.name.startsWith("trace_") && it.name.endsWith(".jsonl") }
            ?.sortedBy { it.name }
            ?.toMutableList() ?: return

        var totalSize = remainingFiles.sumOf { it.length() }
        while (totalSize > MAX_SIZE_BYTES && remainingFiles.isNotEmpty()) {
            val oldest = remainingFiles.removeFirstOrNull() ?: break
            totalSize -= oldest.length()
            oldest.delete()
        }
    }
}
