package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.ApiResponse
import com.synapse.message_interface.simulator.MongoSimulatorUnitMessageRepository
import com.synapse.message_interface.simulator.ScenarioStore
import com.synapse.message_interface.simulator.SimulateUnitRequest
import com.synapse.message_interface.simulator.SimulationScenario
import com.synapse.message_interface.simulator.SimulatorService
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

data class MongoQueueEnqueueRequest(val unitId: String, val payload: String)

@RestController
@RequestMapping("/synapse/simulator")
class SimulatorController(
    private val simulatorService: SimulatorService,
    private val scenarioStore: ScenarioStore,
    private val unitMessageRepo: MongoSimulatorUnitMessageRepository,
) {

    // ── Single-unit simulation ─────────────────────────────────────────────────

    /**
     * Injects a message directly into a specific workflow unit and returns per-node trace results.
     * Does NOT go through condition dispatch — targets the unit directly.
     * 입력 메세지는 해당 유닛의 simulator_unit_messages에 덮어쓰기로 저장된다.
     */
    @PostMapping("/execute")
    suspend fun execute(@RequestBody req: SimulateUnitRequest): ResponseEntity<ApiResponse<*>> {
        val result = simulatorService.simulateUnit(req)
        return ResponseEntity.ok(ApiResponse.ok(result))
    }

    /** 특정 유닛에 저장된 단일 테스트 메세지 조회 */
    @GetMapping("/unit-message/{unitId}")
    suspend fun getUnitMessage(@PathVariable unitId: String): ResponseEntity<ApiResponse<*>> {
        val msg = unitMessageRepo.findById(unitId).awaitFirstOrNull()
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error("저장된 테스트 메세지가 없습니다: $unitId"))
        return ResponseEntity.ok(ApiResponse.ok(msg))
    }

    // ── MongoDB 큐 테스트 (MONGO_QUEUE_CONSUMER 유닛 전용) ─────────────────────────────

    /**
     * 테스트 메세지를 해당 유닛의 큐에 발행한 뒤 즉시 디큐하여 파이프라인을 실행한다.
     * 노드별 트레이스를 포함한 UnitSimulationResult를 반환한다.
     */
    @PostMapping("/enqueue-and-consume")
    suspend fun enqueueAndConsume(@RequestBody req: MongoQueueEnqueueRequest): ResponseEntity<ApiResponse<*>> {
        val result = simulatorService.enqueueAndConsume(req.unitId, req.payload)
        return ResponseEntity.ok(ApiResponse.ok(result))
    }

    // ── Scenario CRUD ──────────────────────────────────────────────────────────

    @GetMapping("/scenarios")
    suspend fun listScenarios(): ResponseEntity<ApiResponse<*>> =
        ResponseEntity.ok(ApiResponse.ok(scenarioStore.getAll()))

    @GetMapping("/scenarios/{id}")
    suspend fun getScenario(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        val scenario = scenarioStore.findById(id)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error("시나리오를 찾을 수 없습니다: $id"))
        return ResponseEntity.ok(ApiResponse.ok(scenario))
    }

    @PostMapping("/scenarios")
    suspend fun saveScenario(@RequestBody scenario: SimulationScenario): ResponseEntity<ApiResponse<*>> {
        val saved = scenarioStore.save(scenario)
        return ResponseEntity.ok(ApiResponse.ok(saved))
    }

    @DeleteMapping("/scenarios/{id}")
    suspend fun deleteScenario(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
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
