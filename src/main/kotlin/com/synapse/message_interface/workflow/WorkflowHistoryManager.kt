package com.synapse.message_interface.workflow

import tools.jackson.databind.ObjectMapper
import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.domain.WorkflowTree
import org.springframework.stereotype.Component
import java.io.File
import java.time.Instant

data class WorkflowHistoryEntry(
    val version: Int,
    val modifiedBy: String,
    val modifiedAt: String,
    val tree: WorkflowTree
)

@Component
class WorkflowHistoryManager(
    private val objectMapper: ObjectMapper,
    private val referenceConfigService: ReferenceConfigService
) {
    @Suppress("UNCHECKED_CAST")
    private val maxHistory: Int
        get() {
            val history = referenceConfigService.getConfig()["history"] as? Map<*, *>
            return (history?.get("maxVersions") as? Int) ?: 10
        }

    @Suppress("UNCHECKED_CAST")
    private val historyDir: File
        get() {
            val history = referenceConfigService.getConfig()["history"] as? Map<*, *>
            val dir = history?.get("directory") as? String ?: "workflow-history"
            return File(dir).also { it.mkdirs() }
        }

    fun save(tree: WorkflowTree, modifiedBy: String) {
        val dir = historyDir
        val max = maxHistory
        val files = dir.listFiles()
            ?.filter { it.name.startsWith("history_") && it.name.endsWith(".json") }
            ?.sortedBy { it.name }
            ?: emptyList()

        // Determine next version from the latest existing file before any deletion
        val nextVersion = files.lastOrNull()
            ?.let { runCatching { objectMapper.readValue(it, WorkflowHistoryEntry::class.java).version }.getOrNull() }
            ?.plus(1) ?: 1

        if (files.size >= max) {
            files.take(files.size - max + 1).forEach { it.delete() }
        }

        val timestamp = Instant.now().toString().replace(":", "-")
        val entry = WorkflowHistoryEntry(
            version = nextVersion,
            modifiedBy = modifiedBy,
            modifiedAt = Instant.now().toString(),
            tree = tree
        )
        File(dir, "history_${timestamp}.json")
            .writeText(objectMapper.writeValueAsString(entry))
    }

    fun listHistory(): List<WorkflowHistoryEntry> {
        return historyDir.listFiles()
            ?.filter { it.name.startsWith("history_") && it.name.endsWith(".json") }
            ?.sortedByDescending { it.name }
            ?.map { objectMapper.readValue(it, WorkflowHistoryEntry::class.java) }
            ?: emptyList()
    }

    fun rollbackTo(version: Int): WorkflowTree? {
        return listHistory().find { it.version == version }?.tree
    }
}
