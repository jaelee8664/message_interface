package com.synapse.message_interface.engine

enum class SimulationTraceStatus { SUCCESS, ERROR }

/**
 * Per-node execution trace captured during a simulation run.
 *
 * [inputSnapshot]  — state.currentMap snapshot *before* the node executed.
 * [outputSnapshot] — state.currentMap snapshot *after* success (null on error or stateless nodes).
 * [rawResponse]    — UTF-8 response text from NODE4 sends (null for other nodes or when no response).
 */
data class SimulationNodeTrace(
    val nodeId: String,
    val nodeType: String,
    val status: SimulationTraceStatus,
    val durationMs: Long,
    val inputSnapshot: Map<String, Any?>?,
    val outputSnapshot: Map<String, Any?>?,
    val rawResponse: String? = null,
    val errorMessage: String? = null
)

/** Thread-safe collector passed through a pipeline execution to gather per-node traces inline.
 *  Only instantiated by SimulatorService — never in normal message processing paths. */
class SimulationTraceCollector {
    private val traces = mutableListOf<SimulationNodeTrace>()

    fun record(trace: SimulationNodeTrace) {
        synchronized(traces) { traces.add(trace) }
    }

    fun getTraces(): List<SimulationNodeTrace> = synchronized(traces) { traces.toList() }
}
