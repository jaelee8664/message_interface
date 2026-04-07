package com.synapse.message_interface.simulator

import tools.jackson.core.type.TypeReference
import tools.jackson.databind.ObjectMapper
import jakarta.annotation.PostConstruct
import org.springframework.stereotype.Component
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * File-backed store for simulation scenarios.
 * Persists to `simulator-scenarios.json` in the project working directory (same convention as workflow.json).
 */
@Component
class ScenarioStore(private val objectMapper: ObjectMapper) {

    private val file = File("simulator-scenarios.json")
    private val scenarios = ConcurrentHashMap<String, SimulationScenario>()

    @PostConstruct
    fun init() {
        if (file.exists()) {
            runCatching {
                val list: List<SimulationScenario> = objectMapper.readValue(
                    file, object : TypeReference<List<SimulationScenario>>() {}
                )
                list.forEach { scenarios[it.id] = it }
            }
        }
    }

    fun getAll(): List<SimulationScenario> =
        scenarios.values.sortedByDescending { it.updatedAt }

    fun findById(id: String): SimulationScenario? = scenarios[id]

    fun save(scenario: SimulationScenario): SimulationScenario {
        val toSave = if (scenario.id.isBlank()) {
            scenario.copy(id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now())
        } else {
            scenario.copy(updatedAt = Instant.now())
        }
        scenarios[toSave.id] = toSave
        persist()
        return toSave
    }

    fun delete(id: String): Boolean {
        val removed = scenarios.remove(id) != null
        if (removed) persist()
        return removed
    }

    private fun persist() {
        runCatching {
            objectMapper.writerWithDefaultPrettyPrinter()
                .writeValue(file, scenarios.values.toList())
        }
    }
}
