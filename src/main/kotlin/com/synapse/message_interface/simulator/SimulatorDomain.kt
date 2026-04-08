package com.synapse.message_interface.simulator

import com.synapse.message_interface.engine.SimulationNodeTrace
import java.time.Instant

// ── Scenario definition ───────────────────────────────────────────────────────

data class SimulationScenario(
    val id: String,
    val name: String,
    val description: String = "",
    val steps: List<SimulationStep>,
    val stopOnFailure: Boolean = false,
    val createdAt: Instant = Instant.now(),
    val updatedAt: Instant = Instant.now()
)

data class StepAssertion(
    val fieldPath: String,   // dot-notation path, e.g. "data.status"
    val operator: String,    // "equals" | "contains" | "exists"
    val expectedValue: String = ""
)

/** Per-NODE4-node host/port/ip override for simulation. nodeId is the key in the map. */
data class Node4Override(
    val host: String? = null,
    val port: Int? = null,
    val targetIp: String? = null   // WEBSOCKET_SERVER / TCP_SERVER 대상 IP 오버라이드
)

data class SimulationStep(
    val order: Int,
    val name: String = "",
    val unitId: String,
    val message: String,
    val format: String = "JSON",              // "JSON" | "XML"
    val endpoint: String? = null,
    val protocol: String? = null,             // null → derived from unit's NODE0
    val metadata: Map<String, String> = emptyMap(),
    val node4Overrides: Map<String, Node4Override> = emptyMap(),  // nodeId → override
    val delayAfterMs: Long = 0,
    val useResponseFromPrevStep: Boolean = false,
    val assertions: List<StepAssertion> = emptyList()
)

// ── Single-unit simulation request / result ───────────────────────────────────

data class SimulateUnitRequest(
    val unitId: String,
    val message: String,
    val format: String = "JSON",
    val endpoint: String? = null,
    val protocol: String? = null,   // null → derived from unit's NODE0
    val metadata: Map<String, String> = emptyMap(),
    val node4Overrides: Map<String, Node4Override> = emptyMap()   // nodeId → override
)

data class UnitSimulationResult(
    val success: Boolean,
    val nodeTraces: List<SimulationNodeTrace>,
    val response: String? = null,
    val httpStatus: Int = 200,
    val errorMessage: String? = null,
    val durationMs: Long = 0
)

// ── Scenario run result ───────────────────────────────────────────────────────

data class StepResult(
    val stepOrder: Int,
    val stepName: String,
    val unitId: String,
    val result: UnitSimulationResult
)

data class ScenarioRunResult(
    val scenarioId: String,
    val scenarioName: String,
    val stepResults: List<StepResult>,
    val success: Boolean,
    val totalDurationMs: Long,
    val executedAt: Instant = Instant.now()
)
