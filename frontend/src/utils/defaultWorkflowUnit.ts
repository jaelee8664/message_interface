import { WorkflowUnit, WorkflowCondition, WorkflowNode } from '../types/workflow'
import { generateId } from './generateId'

export function createDefaultWorkflowUnit(
  name: string,
  condition: WorkflowCondition
): WorkflowUnit {
  const unitId = generateId('unit')
  const node0Id = generateId('n0')

  // NODE0 (reception) is the only mandatory node created by default.
  // NODE5 (response) is optional — add it via "+ 노드 추가" if a response is needed.
  const nodes: WorkflowNode[] = [
    {
      id: node0Id,
      nodeType: 'NODE0',
      position: { x: 150, y: 200 },
    },
  ]

  return {
    id: unitId,
    name,
    condition,
    nodes,
    edges: [],
  }
}
