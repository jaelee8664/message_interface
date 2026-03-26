import { Node, Edge } from '@xyflow/react'
import { WorkflowUnit, WorkflowNode, WorkflowEdge } from '../types/workflow'

export const NODE_COLORS: Record<string, string> = {
  NODE0: '#3b82f6',
  NODE1: '#8b5cf6',
  NODE2: '#f59e0b',
  NODE3: '#10b981',
  NODE4: '#ef4444',
  NODE5: '#06b6d4',
}

export const NODE_LABELS: Record<string, string> = {
  NODE0: '수신 프로토콜',
  NODE1: 'Input DTO',
  NODE2: '값 변환',
  NODE3: 'Output DTO',
  NODE4: '송신',
  NODE5: '응답 설정',
}

export function workflowUnitToFlow(
  unit: WorkflowUnit,
  callbacks: {
    onDeleteEdge: (edgeId: string) => void
  }
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = unit.nodes.map((n) => ({
    id: n.id,
    type: 'workflowNode',
    position: n.position,
    data: {
      nodeType: n.nodeType,
      label: NODE_LABELS[n.nodeType] ?? n.nodeType,
      color: NODE_COLORS[n.nodeType] ?? '#64748b',
      definition: n.node0 ?? n.node1 ?? n.node2 ?? n.node3 ?? n.node4 ?? n.node5,
      unitId: unit.id,
      workflowNode: n,
    },
  }))

  const edges: Edge[] = unit.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: 'workflowEdge',
    data: {
      onDeleteEdge: callbacks.onDeleteEdge,
    },
  }))

  return { nodes, edges }
}

/**
 * Convert React Flow nodes/edges back to WorkflowUnit format for saving.
 */
export function flowToWorkflowUnit(
  unit: WorkflowUnit,
  flowNodes: Node[],
  flowEdges: Edge[]
): WorkflowUnit {
  const updatedNodes: WorkflowNode[] = flowNodes.map((fn) => {
    const nodeData = (fn.data as any)?.workflowNode as WorkflowNode | undefined
    if (!nodeData) {
      // New node added on canvas (no workflowNode in data yet)
      return {
        id: fn.id,
        nodeType: (fn.data as any)?.nodeType ?? 'NODE0',
        position: fn.position,
      }
    }
    return { ...nodeData, position: fn.position }
  })

  const updatedEdges: WorkflowEdge[] = flowEdges.map((fe) => ({
    id: fe.id,
    sourceNodeId: fe.source,
    targetNodeId: fe.target,
    isDashed: false,
  }))

  return { ...unit, nodes: updatedNodes, edges: updatedEdges }
}
