package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.*
import com.synapse.message_interface.config.ReferenceConfigService
import com.synapse.message_interface.config.WorkflowPersistenceConfig
import com.synapse.message_interface.domain.NodeType
import com.synapse.message_interface.domain.ProtocolType
import com.synapse.message_interface.domain.WorkflowTree
import com.synapse.message_interface.reception.ReceptionManager
import com.synapse.message_interface.workflow.WorkflowConditionValidator
import com.synapse.message_interface.workflow.WorkflowDiffService
import com.synapse.message_interface.workflow.WorkflowHistoryManager
import com.synapse.message_interface.workflow.WorkflowRegistry
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/workflow")
class WorkflowController(
    private val registry: WorkflowRegistry,
    private val historyManager: WorkflowHistoryManager,
    private val conditionValidator: WorkflowConditionValidator,
    private val persistenceConfig: WorkflowPersistenceConfig,
    private val receptionManager: ReceptionManager,
    private val referenceConfigService: ReferenceConfigService,
    private val diffService: WorkflowDiffService
) {
    private val editPassword: String get() = referenceConfigService.getEditPassword()

    @GetMapping("/units")
    fun getAllUnits(): ResponseEntity<ApiResponse<List<*>>> =
        ResponseEntity.ok(ApiResponse.ok(registry.getAll()))

    @GetMapping("/units/{id}")
    fun getUnit(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        val unit = registry.findById(id)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(ApiResponse.ok(unit))
    }

    @PostMapping("/units")
    suspend fun saveUnit(@RequestBody req: SaveWorkflowRequest): ResponseEntity<ApiResponse<*>> {
        if (req.password != editPassword) {
            return ResponseEntity.status(403).body(ApiResponse.error("비밀번호가 올바르지 않습니다."))
        }
        if (req.modifiedBy.isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("수정자 이름을 입력해 주세요."))
        }

        // Validate REST_SERVER path not in reserved /synapse/** namespace
        val reservedPathUnit = req.unit.nodes.firstOrNull { node ->
            node.node0?.protocol == com.synapse.message_interface.domain.ProtocolType.REST_SERVER &&
            node.node0.path?.startsWith("/synapse/") == true
        }
        if (reservedPathUnit != null) {
            return ResponseEntity.badRequest().body(ApiResponse.error(
                "REST Server endpoint는 /synapse/ 로 시작할 수 없습니다. (예약된 내부 경로)"
            ))
        }

        // Validate condition no intersection — only compare units with the same NODE0 protocol
        val newProtocol = req.unit.nodes.find { it.nodeType == NodeType.NODE0 }?.node0?.protocol
        val existingConditions = registry.getAll()
            .filter { it.id != req.unit.id }
            .filter { unit ->
                val p = unit.nodes.find { it.nodeType == NodeType.NODE0 }?.node0?.protocol
                newProtocol == null || p == null || p == newProtocol
            }
            .map { it.condition }
        val conflicts = conditionValidator.validateNoIntersection(req.unit.condition, existingConditions)
        if (conflicts.isNotEmpty()) {
            val msg = conflicts.joinToString("\n") {
                "⚠️ 조건 교집합 감지: [${it.existingConditionExpression}] vs [${it.newConditionExpression}] → ${it.reason}"
            }
            return ResponseEntity.badRequest().body(ApiResponse.error(msg))
        }

        historyManager.save(registry.getAll(), req.modifiedBy)

        registry.addOrUpdate(req.unit)
        receptionManager.restartUnit(req.unit)
        persistenceConfig.saveUnit(req.unit)

        return ResponseEntity.ok(ApiResponse.ok(req.unit))
    }

    @DeleteMapping("/units")
    suspend fun deleteUnit(@RequestBody req: DeleteWorkflowRequest): ResponseEntity<ApiResponse<*>> {
        if (req.password != editPassword) {
            return ResponseEntity.status(403).body(ApiResponse.error("비밀번호가 올바르지 않습니다."))
        }
        historyManager.save(registry.getAll(), req.modifiedBy)
        registry.remove(req.unitId)
        receptionManager.stopHandlers(req.unitId)
        persistenceConfig.deleteUnit(req.unitId)
        return ResponseEntity.ok(ApiResponse.ok("삭제 완료"))
    }

    @PostMapping("/condition/validate")
    fun validateCondition(@RequestBody req: ValidateConditionRequest): ResponseEntity<ApiResponse<*>> {
        val existingConditions = registry.getAll()
            .filter { it.id != req.unitId }
            .filter { unit ->
                val p = unit.nodes.find { it.nodeType == NodeType.NODE0 }?.node0?.protocol
                req.protocol == null || p == null || p == req.protocol
            }
            .map { it.condition }
        val conflicts = conditionValidator.validateNoIntersection(req.condition, existingConditions)
        return if (conflicts.isEmpty()) {
            ResponseEntity.ok(ApiResponse.ok(mapOf("valid" to true, "conflicts" to emptyList<Any>())))
        } else {
            val msgs = conflicts.map { mapOf(
                "existing" to it.existingConditionExpression,
                "new" to it.newConditionExpression,
                "reason" to it.reason
            )}
            ResponseEntity.ok(ApiResponse.ok(mapOf("valid" to false, "conflicts" to msgs)))
        }
    }

    @GetMapping("/history")
    suspend fun getHistory() = ResponseEntity.ok(ApiResponse.ok(historyManager.listHistory()))

    @GetMapping("/diff")
    suspend fun getDiff(@RequestParam version: Int): ResponseEntity<ApiResponse<*>> {
        val entry = historyManager.listHistory().find { it.version == version }
            ?: return ResponseEntity.badRequest().body(ApiResponse.error("버전 $version 을 찾을 수 없습니다."))
        val currentTree = WorkflowTree(registry.getAll())
        return ResponseEntity.ok(ApiResponse.ok(diffService.diff(entry, currentTree)))
    }

    @PostMapping("/rollback")
    suspend fun rollback(@RequestBody req: RollbackRequest): ResponseEntity<ApiResponse<*>> {
        if (req.password != editPassword) {
            return ResponseEntity.status(403).body(ApiResponse.error("비밀번호가 올바르지 않습니다."))
        }
        val units = historyManager.rollbackTo(req.version)
            ?: return ResponseEntity.badRequest().body(ApiResponse.error("해당 버전을 찾을 수 없습니다."))
        registry.load(WorkflowTree(units))
        persistenceConfig.replaceAll(units)
        return ResponseEntity.ok(ApiResponse.ok("버전 ${req.version}으로 롤백 완료"))
    }
}
