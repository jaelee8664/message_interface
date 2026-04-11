import { WorkflowUnit, WorkflowCondition, WorkflowNode, ProtocolType } from '../types/workflow'
import { generateId } from './generateId'

export function createDefaultWorkflowUnit(
  name: string,
  condition: WorkflowCondition,
  protocol: ProtocolType
): WorkflowUnit {
  const unitId = generateId('unit')
  const node0Id = generateId('n0')
  const node1Id = generateId('n1')
  const node5Id = generateId('n5')

  const isMongoQueueConsumer = protocol === 'MONGO_QUEUE_CONSUMER'

  // Default graph:
  // - Most protocols: create only NODE0 (reception)
  // - MONGO_QUEUE_CONSUMER: create NODE0 → NODE1 → NODE5, so polling returns a controlled HTTP response.
  const nodes: WorkflowNode[] = [
    {
      id: node0Id,
      nodeType: 'NODE0',
      node0: {
        protocol,
        pingEnabled: false,
        pingIntervalSeconds: 30,
        pongTimeoutSeconds: 10,
        reconnectEnabled: true,
        reconnectDelaySeconds: 5,
        bidirectional: false,
        ...(isMongoQueueConsumer
          ? {
              path: '/queue/example',
              mongoQueueName: 'example-queue',
              mongoQueueMaxRetries: 3,
            }
          : {}),
      },
      position: { x: 150, y: 200 },
    },
  ]

  if (isMongoQueueConsumer) {
    nodes.push(
      {
        id: node1Id,
        nodeType: 'NODE1',
        node1: {
          messageFormat: 'JSON',
          fields: [],
          customDtos: [],
        },
        position: { x: 450, y: 200 },
      },
      {
        id: node5Id,
        nodeType: 'NODE5',
        node5: {
          responseType: 'HTTP_RESPONSE',
          successConfig: {
            httpStatus: 200,
            messageFormat: 'JSON',
            fields: [],
          },
          defaultErrorConfig: {
            messageFormat: 'JSON',
            fields: [
              { key: 'error', source: 'EXCEPTION_MESSAGE', value: '' },
            ],
          },
        },
        position: { x: 750, y: 200 },
      },
    )
  }

  return {
    id: unitId,
    name,
    condition,
    nodes,
    edges: isMongoQueueConsumer
      ? [
          { id: generateId('e'), sourceNodeId: node0Id, targetNodeId: node1Id, isDashed: false },
          { id: generateId('e'), sourceNodeId: node1Id, targetNodeId: node5Id, isDashed: false },
        ]
      : [],
  }
}
