package com.synapse.message_interface.log

import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.deadletter.DeadLetterStore
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Component
class LogRetentionScheduler(
    private val deadLetterStore: DeadLetterStore,
    private val referenceConfigService: ReferenceConfigService
) {
    companion object {
        const val DEFAULT_LOG_DIR = "message-logs"
        const val DEFAULT_LOG_RETENTION_DAYS = 7L
        const val DEFAULT_LOG_MAX_SIZE_GB = 10L
        const val DEFAULT_LOG_CLEANUP_INTERVAL_HOURS = 24L
        const val DEFAULT_DEAD_LETTER_CLEANUP_INTERVAL_HOURS = 24L
    }

    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var lastLogCleanupMs = 0L
    private var lastDeadLetterCleanupMs = 0L

    @PostConstruct
    fun init() {
        startLogCleanupJob()
        startDeadLetterCleanupJob()
    }

    @PreDestroy
    fun destroy() {
        scope.cancel()
    }

    // ── Config helpers ────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun logConfig(): Map<*, *>? =
        referenceConfigService.getConfig()["log"] as? Map<*, *>

    private fun getLogDirectory(): String =
        logConfig()?.get("directory") as? String ?: DEFAULT_LOG_DIR

    private fun getLogRetentionDays(): Long =
        (logConfig()?.get("retentionDays") as? Number)?.toLong() ?: DEFAULT_LOG_RETENTION_DAYS

    private fun getLogMaxSizeBytes(): Long =
        ((logConfig()?.get("maxSizeGb") as? Number)?.toLong() ?: DEFAULT_LOG_MAX_SIZE_GB) * 1024 * 1024 * 1024

    private fun getLogCleanupIntervalMs(): Long =
        ((logConfig()?.get("cleanupIntervalHours") as? Number)?.toLong()
            ?: DEFAULT_LOG_CLEANUP_INTERVAL_HOURS) * 3_600_000L

    @Suppress("UNCHECKED_CAST")
    private fun deadLetterConfig(): Map<*, *>? =
        referenceConfigService.getConfig()["deadLetter"] as? Map<*, *>

    private fun getDeadLetterCleanupIntervalMs(): Long =
        ((deadLetterConfig()?.get("cleanupIntervalHours") as? Number)?.toLong()
            ?: DEFAULT_DEAD_LETTER_CLEANUP_INTERVAL_HOURS) * 3_600_000L

    // ── Cleanup jobs ──────────────────────────────────────────────────────────

    private fun startLogCleanupJob() {
        scope.launch {
            runLogCleanupSafe()
            lastLogCleanupMs = System.currentTimeMillis()
            while (true) {
                delay(60_000L)
                if (System.currentTimeMillis() - lastLogCleanupMs >= getLogCleanupIntervalMs()) {
                    runLogCleanupSafe()
                    lastLogCleanupMs = System.currentTimeMillis()
                }
            }
        }
    }

    private fun startDeadLetterCleanupJob() {
        scope.launch {
            runDeadLetterCleanupSafe()
            lastDeadLetterCleanupMs = System.currentTimeMillis()
            while (true) {
                delay(60_000L)
                if (System.currentTimeMillis() - lastDeadLetterCleanupMs >= getDeadLetterCleanupIntervalMs()) {
                    runDeadLetterCleanupSafe()
                    lastDeadLetterCleanupMs = System.currentTimeMillis()
                }
            }
        }
    }

    private fun runLogCleanupSafe() {
        try {
            runLogCleanup()
        } catch (e: Exception) {
            log.error("[LogRetention] 로그 정리 오류: ${e.message}", e)
        }
    }

    private fun runDeadLetterCleanupSafe() {
        try {
            deadLetterStore.runRetention()
            log.info("[LogRetention] Dead Letter 정리 완료")
        } catch (e: Exception) {
            log.error("[LogRetention] Dead Letter 정리 오류: ${e.message}", e)
        }
    }

    private fun runLogCleanup() {
        val logDir = File(getLogDirectory()).also { it.mkdirs() }
        val retentionDays = getLogRetentionDays()
        val maxSizeBytes = getLogMaxSizeBytes()

        val cutoff = LocalDate.now().minusDays(retentionDays)
        val allFiles = logDir.listFiles()
            ?.filter { it.name.startsWith("trace_") && it.name.endsWith(".jsonl") }
            ?.sortedBy { it.name }
            ?: return

        // 보존 기간 초과 파일 삭제
        var deletedCount = 0
        allFiles.forEach { file ->
            runCatching {
                // 파일명: trace_2026-04-29T14.jsonl → 앞 10자만 날짜 파싱
                val dateStr = file.name.removePrefix("trace_").removeSuffix(".jsonl").take(10)
                val fileDate = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
                if (fileDate.isBefore(cutoff)) {
                    file.delete()
                    deletedCount++
                }
            }
        }
        if (deletedCount > 0) log.info("[LogRetention] 보존 기간(${retentionDays}일) 초과 로그 삭제: ${deletedCount}건")

        // 총 용량 초과 시 오래된 파일부터 삭제
        val remainingFiles = logDir.listFiles()
            ?.filter { it.name.startsWith("trace_") && it.name.endsWith(".jsonl") }
            ?.sortedBy { it.name }
            ?.toMutableList() ?: return

        var totalSize = remainingFiles.sumOf { it.length() }
        var sizeDeletedCount = 0
        while (totalSize > maxSizeBytes && remainingFiles.isNotEmpty()) {
            val oldest = remainingFiles.removeFirstOrNull() ?: break
            totalSize -= oldest.length()
            oldest.delete()
            sizeDeletedCount++
        }
        if (sizeDeletedCount > 0) log.warn("[LogRetention] 용량 초과로 오래된 로그 삭제: ${sizeDeletedCount}건")
    }
}
