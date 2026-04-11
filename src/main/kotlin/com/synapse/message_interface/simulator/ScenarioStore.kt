package com.synapse.message_interface.simulator

import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * MongoDB-backed store for simulation scenarios.
 * collection: simulator_scenarios
 */
@Component
class ScenarioStore(private val repo: MongoSimulationScenarioRepository) {

    suspend fun getAll(): List<SimulationScenario> =
        repo.findAll().collectList().awaitFirstOrNull()
            ?.sortedByDescending { it.updatedAt }
            ?: emptyList()

    suspend fun findById(id: String): SimulationScenario? =
        repo.findById(id).awaitFirstOrNull()

    suspend fun save(scenario: SimulationScenario): SimulationScenario {
        val toSave = if (scenario.id.isBlank()) {
            scenario.copy(id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now())
        } else {
            scenario.copy(updatedAt = Instant.now())
        }
        return repo.save(toSave).awaitFirstOrNull() ?: toSave
    }

    suspend fun delete(id: String): Boolean {
        if (repo.existsById(id).awaitFirstOrNull() != true) return false
        repo.deleteById(id).awaitFirstOrNull()
        return true
    }
}
