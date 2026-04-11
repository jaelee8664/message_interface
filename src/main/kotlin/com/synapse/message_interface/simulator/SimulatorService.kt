package com.synapse.message_interface.simulator

import com.synapse.message_interface.domain.MessageFormat
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.WorkflowUnit
import com.synapse.message_interface.engine.MessageContext
import com.synapse.message_interface.engine.MessagePipeline
import com.synapse.message_interface.engine.SimulationTraceCollector
import com.synapse.message_interface.log.MessageTraceLogger
import com.synapse.message_interface.parser.MessageParserRegistry
import com.synapse.message_interface.queue.MongoQueueService
import com.synapse.message_interface.workflow.WorkflowRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.reactive.awaitFirstOrNull
import org.springframework.stereotype.Service
import tools.jackson.databind.ObjectMapper
import java.time.Instant
import java.util.UUID

@Service
class SimulatorService(
    private val workflowRegistry: WorkflowRegistry,
    private val messagePipeline: MessagePipeline,
    private val parserRegistry: MessageParserRegistry,
    private val scenarioStore: ScenarioStore,
    private val unitMessageRepo: MongoSimulatorUnitMessageRepository,
    private val mongoQueueService: MongoQueueService,
    private val messageTraceLogger: MessageTraceLogger,
    private val objectMapper: ObjectMapper,
) {

    /**
     * Injects a message directly into a specific workflow unit and returns per-node trace results.
     * Dead letters are NOT written — this is a simulation, not a real failure.
     * 입력 메세지는 해당 유닛의 simulator_unit_messages 도큐먼트에 덮어써서 저장된다.
     */
    suspend fun simulateUnit(req: SimulateUnitRequest): UnitSimulationResult {
        val unit = workflowRegistry.findById(req.unitId)
            ?: return UnitSimulationResult(
                success = false,
                nodeTraces = emptyList(),
                errorMessage = "유닛을 찾을 수 없습니다: ${req.unitId}"
            )

        val effectiveUnit = applyTargetOverride(unit, req.node4Overrides)
        val rawBytes = req.message.toByteArray(Charsets.UTF_8)
        val format = runCatching { MessageFormat.valueOf(req.format.uppercase()) }.getOrDefault(MessageFormat.JSON)

        val parsedMessage = runCatching {
            parserRegistry.getParser(format).parse(rawBytes).toMutableMap()
        }.getOrNull()

        // Derive protocol and endpoint from NODE0 if not explicitly provided
        val node0 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE0 }
        val effectiveProtocol = req.protocol ?: node0?.node0?.protocol?.name ?: "REST_SERVER"
        val effectiveEndpoint = req.endpoint ?: node0?.node0?.path

        val context = MessageContext(
            rawBytes = rawBytes,
            endpoint = effectiveEndpoint,
            protocol = effectiveProtocol,
            metadata = req.metadata,
            parsedMessage = parsedMessage
        )

        val traceCollector = SimulationTraceCollector()
        val startMs = System.currentTimeMillis()

        val result = try {
            val pipelineResult = messagePipeline.execute(context, effectiveUnit, traceCollector)
            UnitSimulationResult(
                success = true,
                nodeTraces = traceCollector.getTraces(),
                response = pipelineResult.body?.toString(Charsets.UTF_8),
                httpStatus = pipelineResult.httpStatus,
                durationMs = System.currentTimeMillis() - startMs
            )
        } catch (e: Exception) {
            UnitSimulationResult(
                success = false,
                nodeTraces = traceCollector.getTraces(),
                errorMessage = e.message,
                durationMs = System.currentTimeMillis() - startMs
            )
        }

        // unitId = _id 이므로 save()가 자동으로 upsert 역할을 한다
        // skipMessageSave=true이면 저장 생략 (로그 플레이 등 내부 호출 시 기존 테스트 메세지를 보존)
        if (!req.skipMessageSave) {
            unitMessageRepo.save(SimulatorUnitMessage(
                unitId = req.unitId,
                message = req.message,
                format = req.format,
                endpoint = effectiveEndpoint,
                protocol = effectiveProtocol,
                metadata = req.metadata,
                node4Overrides = req.node4Overrides
            )).awaitFirstOrNull()
        }

        return result
    }

    // ── Log Play ──────────────────────────────────────────────────────────────

    /**
     * 지정된 초 단위 시간(1초 윈도우)에 수신된 NODE0 로그를 JSONL 파일에서 조회한다.
     * datetime은 ISO-8601 UTC 문자열 (예: "2026-04-11T15:32:07Z").
     * unitIds에 해당하는 유닛의 로그만 반환한다.
     */
    suspend fun fetchLogPlayEntries(req: LogPlayFetchRequest): List<LogPlayEntry> {
        val from = Instant.parse(req.datetimeFrom)
        val to = Instant.parse(req.datetimeTo)
        val logs = messageTraceLogger.fetchNode0LogsByTimeAndUnits(from, to, req.unitIds.toSet())
        return logs.map { log ->
            LogPlayEntry(
                traceId = log.traceId,
                workflowUnitId = log.workflowUnitId,
                workflowUnitName = log.workflowUnitName,
                timestamp = log.timestamp.toString(),
                message = objectMapper.writeValueAsString(log.messageSnippet),
                format = "JSON"
            )
        }
    }

    /**
     * 로그 플레이 실행: 각 LogPlayEntry를 해당 유닛의 파이프라인으로 재실행한다.
     * 기존 저장된 테스트 메세지는 덮어쓰지 않는다(skipMessageSave=true).
     */
    suspend fun runLogPlay(req: LogPlayRunRequest): List<LogPlayRunResultItem> {
        return req.entries.map { entry ->
            val result = simulateUnit(
                SimulateUnitRequest(
                    unitId = entry.workflowUnitId,
                    message = entry.message,
                    format = entry.format,
                    node4Overrides = req.node4Overrides,
                    skipMessageSave = true
                )
            )
            LogPlayRunResultItem(
                traceId = entry.traceId,
                workflowUnitId = entry.workflowUnitId,
                workflowUnitName = entry.workflowUnitName,
                result = result
            )
        }
    }

    /**
     * MONGO_QUEUE_CONSUMER 유닛 전용 실제 흐름 테스트.
     *
     * 1. [payload]를 해당 유닛의 큐에 발행
     * 2. 발행한 메세지를 즉시 디큐하여 파이프라인 실행
     * 3. 노드별 트레이스와 함께 결과 반환
     *
     * 큐에 다른 PENDING 메세지가 먼저 있으면 그 메세지가 먼저 소비될 수 있다.
     */
    suspend fun enqueueAndConsume(unitId: String, payload: String): UnitSimulationResult {
        val unit = workflowRegistry.findById(unitId)
            ?: return UnitSimulationResult(success = false, nodeTraces = emptyList(), errorMessage = "유닛을 찾을 수 없습니다: $unitId")

        val node0 = unit.nodes.firstOrNull { it.nodeType == NodeType.NODE0 }?.node0
            ?: return UnitSimulationResult(success = false, nodeTraces = emptyList(), errorMessage = "NODE0가 없습니다.")
        val queueName = node0.mongoQueueName
            ?: return UnitSimulationResult(success = false, nodeTraces = emptyList(), errorMessage = "NODE0에 큐 이름이 설정되지 않았습니다.")
        val path = node0.path ?: ""

        // 1) 발행
        val messageId = UUID.randomUUID().toString()
        mongoQueueService.publish(queueName, payload.toByteArray(Charsets.UTF_8), messageId)

        // 2) 디큐
        val lockId = UUID.randomUUID().toString()
        val message = mongoQueueService.dequeue(queueName, lockId)
            ?: return UnitSimulationResult(success = true, nodeTraces = emptyList(), httpStatus = 204, errorMessage = "디큐 결과 없음 — 큐가 비어있습니다.")

        val ctx = MessageContext(
            rawBytes = message.payload,
            endpoint = path,
            protocol = "MONGO_QUEUE_CONSUMER",
            metadata = mapOf(
                "messageId" to message.messageId,
                "queueName" to queueName,
                "publishedAt" to message.publishedAt.toString()
            )
        )

        val traceCollector = SimulationTraceCollector()
        val startMs = System.currentTimeMillis()
        return try {
            val pipelineResult = messagePipeline.execute(ctx, unit, traceCollector)
            mongoQueueService.markDone(message)
            UnitSimulationResult(
                success = true,
                nodeTraces = traceCollector.getTraces(),
                response = pipelineResult.body?.toString(Charsets.UTF_8),
                httpStatus = pipelineResult.httpStatus,
                durationMs = System.currentTimeMillis() - startMs
            )
        } catch (e: Exception) {
            val newRetryCount = message.retryCount + 1
            if (newRetryCount >= node0.mongoQueueMaxRetries) mongoQueueService.markFailed(message)
            else mongoQueueService.resetPending(message, incrementRetry = true)
            UnitSimulationResult(
                success = false,
                nodeTraces = traceCollector.getTraces(),
                errorMessage = e.message,
                durationMs = System.currentTimeMillis() - startMs
            )
        }
    }

    /** Runs a saved scenario by ID. */
    suspend fun runScenario(scenarioId: String): ScenarioRunResult {
        val scenario = scenarioStore.findById(scenarioId)
            ?: throw NoSuchElementException("시나리오를 찾을 수 없습니다: $scenarioId")
        return executeScenario(scenario)
    }

    /** Runs a scenario ad-hoc (without saving). */
    suspend fun runAdHoc(scenario: SimulationScenario): ScenarioRunResult =
        executeScenario(scenario)

    private suspend fun executeScenario(scenario: SimulationScenario): ScenarioRunResult {
        val stepResults = mutableListOf<StepResult>()
        val startMs = System.currentTimeMillis()

        for (step in scenario.steps.sortedBy { it.order }) {
            val result = simulateUnit(SimulateUnitRequest(
                unitId = step.unitId,
                message = step.message,
                format = step.format,
                endpoint = step.endpoint,
                protocol = step.protocol,
                metadata = step.metadata,
                node4Overrides = step.node4Overrides
            ))
            stepResults.add(StepResult(
                stepOrder = step.order,
                stepName = step.name,
                unitId = step.unitId,
                result = result
            ))
            if (step.delayAfterMs > 0) delay(step.delayAfterMs)
        }

        return ScenarioRunResult(
            scenarioId = scenario.id,
            scenarioName = scenario.name,
            stepResults = stepResults,
            success = stepResults.all { it.result.success },
            totalDurationMs = System.currentTimeMillis() - startMs
        )
    }

    /** Deep-copies the unit and applies per-NODE4-node host/port overrides for simulation. */
    private fun applyTargetOverride(unit: WorkflowUnit, overrides: Map<String, Node4Override>): WorkflowUnit {
        if (overrides.isEmpty()) return unit
        val modifiedNodes = unit.nodes.map { node ->
            val override = overrides[node.id]
            if (node.nodeType == NodeType.NODE4 && node.node4 != null && override != null) {
                node.copy(node4 = node.node4.copy(
                    targetHost = override.host ?: node.node4.targetHost,
                    targetPort = override.port ?: node.node4.targetPort,
                    targetPath = override.targetIp ?: node.node4.targetPath
                ))
            } else node
        }
        return unit.copy(nodes = modifiedNodes)
    }
}
