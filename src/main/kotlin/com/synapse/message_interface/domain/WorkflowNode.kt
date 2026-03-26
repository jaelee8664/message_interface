package com.synapse.message_interface.domain

import com.synapse.message_interface.domain.node.*

enum class NodeType { NODE0, NODE1, NODE2, NODE3, NODE4, NODE5 }

data class WorkflowNode(
    val id: String,
    val nodeType: NodeType,
    val node0: Node0Definition? = null,
    val node1: Node1Definition? = null,
    val node2: Node2Definition? = null,
    val node3: Node3Definition? = null,
    val node4: Node4Definition? = null,
    val node5: Node5Definition? = null,
    val position: NodePosition = NodePosition(0.0, 0.0),
    val customErrorMessage: String? = null,  // custom message shown when this node throws an exception
    /**
     * Per-node error response override.
     * - null  → use NODE5's [Node5Definition.defaultErrorConfig]
     * - set   → this definition is used instead of the NODE5 default
     */
    val errorResponse: NodeErrorResponse? = null
)

data class NodePosition(val x: Double, val y: Double)

data class WorkflowEdge(
    val id: String,
    val sourceNodeId: String,
    val targetNodeId: String,
    val isDashed: Boolean = false
)
