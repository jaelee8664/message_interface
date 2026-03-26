package com.synapse.message_interface.workflow

import com.synapse.message_interface.domain.WorkflowTree
import com.synapse.message_interface.domain.WorkflowUnit
import org.springframework.stereotype.Component
import java.util.concurrent.CopyOnWriteArrayList

@Component
class WorkflowRegistry {
    private val tree = CopyOnWriteArrayList<WorkflowUnit>()

    fun getAll(): List<WorkflowUnit> = tree.toList()

    fun load(workflowTree: WorkflowTree) {
        tree.clear()
        tree.addAll(workflowTree.units)
    }

    fun addOrUpdate(unit: WorkflowUnit) {
        tree.removeIf { it.id == unit.id }
        tree.add(unit)
    }

    fun remove(unitId: String) {
        tree.removeIf { it.id == unitId }
    }

    fun findById(unitId: String): WorkflowUnit? = tree.find { it.id == unitId }
}
