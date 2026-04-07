package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.simulator.ScenarioStore
import com.synapse.message_interface.simulator.SimulateUnitRequest
import com.synapse.message_interface.simulator.SimulationScenario
import com.synapse.message_interface.simulator.SimulatorService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/simulator")
class SimulatorController(
    private val simulatorService: SimulatorService,
    private val scenarioStore: ScenarioStore
) {

    // ── Single-unit simulation ─────────────────────────────────────────────────

    /**
     * Injects a message directly into a specific workflow unit and returns per-node trace results.
     * Does NOT go through condition dispatch — targets the unit directly.
     */
    @PostMapping("/execute")
    suspend fun execute(@RequestBody req: SimulateUnitRequest): ResponseEntity<ApiResponse<*>> {
        val result = simulatorService.simulateUnit(req)
        return ResponseEntity.ok(ApiResponse.ok(result))
    }

    // ── Scenario CRUD ──────────────────────────────────────────────────────────

    @GetMapping("/scenarios")
    fun listScenarios(): ResponseEntity<ApiResponse<*>> =
        ResponseEntity.ok(ApiResponse.ok(scenarioStore.getAll()))

    @GetMapping("/scenarios/{id}")
    fun getScenario(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        val scenario = scenarioStore.findById(id)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error("시나리오를 찾을 수 없습니다: $id"))
        return ResponseEntity.ok(ApiResponse.ok(scenario))
    }

    @PostMapping("/scenarios")
    fun saveScenario(@RequestBody scenario: SimulationScenario): ResponseEntity<ApiResponse<*>> {
        val saved = scenarioStore.save(scenario)
        return ResponseEntity.ok(ApiResponse.ok(saved))
    }

    @DeleteMapping("/scenarios/{id}")
    fun deleteScenario(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        val deleted = scenarioStore.delete(id)
        return if (deleted) ResponseEntity.ok(ApiResponse.ok("삭제되었습니다"))
        else ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error("시나리오를 찾을 수 없습니다: $id"))
    }

    // ── Scenario execution ─────────────────────────────────────────────────────

    /** Runs a saved scenario by ID. */
    @PostMapping("/scenarios/{id}/run")
    suspend fun runScenario(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        return try {
            val result = simulatorService.runScenario(id)
            ResponseEntity.ok(ApiResponse.ok(result))
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error(e.message ?: "Not found"))
        }
    }

    /** Runs a scenario ad-hoc (without saving first). */
    @PostMapping("/scenarios/run")
    suspend fun runAdHoc(@RequestBody scenario: SimulationScenario): ResponseEntity<ApiResponse<*>> {
        val result = simulatorService.runAdHoc(scenario)
        return ResponseEntity.ok(ApiResponse.ok(result))
    }
}
