export type MessageFormat = 'JSON' | 'XML'
export type ProtocolType =
  | 'WEBSOCKET_SERVER' | 'WEBSOCKET_CLIENT'
  | 'TCP_SERVER' | 'TCP_CLIENT'
  | 'KAFKA_CONSUMER' | 'KAFKA_PUBLISHER'
  | 'REST_SERVER'
export type FieldType = 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN' | 'LIST' | 'MAP' | 'CUSTOM'
export type NodeType = 'NODE0' | 'NODE1' | 'NODE2' | 'NODE3' | 'NODE4' | 'NODE5'
export type ConditionType = 'ENDPOINT' | 'FIELD_VALUE' | 'CONTAINS_KEY'
export type LogicalOp = 'AND' | 'OR'

export interface FieldDefinition {
  key: string
  type: FieldType
  customTypeName?: string
  listItemType?: FieldType
  defaultValue?: string
  nullable: boolean
  mandatory: boolean
  description: string
}

export interface Node0Definition {
  protocol: ProtocolType
  host?: string
  port?: number
  path?: string
  topic?: string
  groupId?: string
  pingEnabled: boolean
  pingIntervalSeconds: number
  reconnectEnabled: boolean
  reconnectDelaySeconds: number
  bidirectional: boolean
}

export interface Node1Definition {
  messageFormat: MessageFormat
  fields: FieldDefinition[]
  customDtos: Array<{ name: string; fields: FieldDefinition[] }>
}

export interface ValueReplaceRule { key: string; matchValue: string; afterValue: string }
export interface TypeConvertRule { key: string; beforeType: FieldType; afterType: FieldType }
export interface CustomCodeRule { key: string; code: string; afterType?: FieldType }

export interface Node2Definition {
  valueReplaceRules: ValueReplaceRule[]
  typeConvertRules: TypeConvertRule[]
  customCodeRules: CustomCodeRule[]
}

export type ListAddItemType = 'FIXED' | 'FIELD_REF' | 'EXPR'
export type FixedValueType = 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN'

export interface ListAddItem {
  type: ListAddItemType
  fixedValue?: string         // FIXED: string representation
  fixedType?: FixedValueType  // FIXED: value type; undefined → null value
  fieldRef?: string           // FIELD_REF: dot-notation key into input data
  expr?: string               // EXPR: JS expression returning any value; {$key} refs supported
  prepend?: boolean           // true = insert at front, false/undefined = append at end
  addCondition?: string       // JS expression against flat outer DTO; undefined = always add
}

export interface ItemFieldMapping {
  newKey: string
  beforeKey: string
}

export interface DtoMapping {
  newKey: string
  beforeKey: string
  filterCode?: string
  listAddItems?: ListAddItem[]
  itemMappings?: ItemFieldMapping[]
}
export interface Node3Definition { mappings: DtoMapping[] }

export interface Node4Definition {
  messageFormat: MessageFormat
  protocol: ProtocolType
  targetHost?: string
  targetPort?: number
  targetPath?: string
  targetTopic?: string
  retryCount?: number
  retryDelaySeconds?: number
  timeoutMs?: number
  reconnectEnabled?: boolean
  reconnectDelaySeconds?: number
}

// ── NODE5 – Response node ─────────────────────────────────────────────────────

/**
 * How NODE5 returns a mandatory server response.
 * Limited to protocols that require a response to unblock the caller.
 *
 * - HTTP_RESPONSE:  HTTP response to a REST client (httpStatus applies)
 *
 * For session-based push (WebSocket, TCP), use NODE4.
 */
export type Node5ResponseType = 'HTTP_RESPONSE'

/**
 * Success response config.
 * Body is built field-by-field from [fields] (LITERAL / FROM_MAP sources).
 * If [fields] is empty the response body is empty.
 * httpStatus is only used when responseType is HTTP_RESPONSE.
 */
export interface Node5SuccessConfig {
  httpStatus: number
  messageFormat: MessageFormat
  fields: NodeErrorField[]
}

// ── Per-node error response ───────────────────────────────────────────────────

/** Where the runtime value for an error response field comes from. */
export type NodeErrorFieldSource = 'LITERAL' | 'FROM_MAP' | 'EXCEPTION_MESSAGE'

/**
 * A single field in the error response body.
 * - LITERAL: value is used as-is
 * - FROM_MAP: value is a key into currentMap at error time
 * - EXCEPTION_MESSAGE: exception.message is injected (value is ignored)
 */
export interface NodeErrorField {
  key: string
  source: NodeErrorFieldSource
  value: string
}

/**
 * Describes the error response body for a failed node.
 *
 * Used in:
 * - Node5Definition.defaultErrorConfig — the NODE5-level fallback for all nodes
 * - WorkflowNode.errorResponse — a per-node override (null = use NODE5 default)
 */
export interface NodeErrorResponse {
  messageFormat: MessageFormat
  fields: NodeErrorField[]
}

export interface Node5Definition {
  responseType: Node5ResponseType
  successConfig: Node5SuccessConfig
  /** Fallback error response used for any node that does not override with its own errorResponse. */
  defaultErrorConfig: NodeErrorResponse
}

// ── WorkflowUnit structure ────────────────────────────────────────────────────

export interface NodePosition { x: number; y: number }

export interface WorkflowNode {
  id: string
  nodeType: NodeType
  node0?: Node0Definition
  node1?: Node1Definition
  node2?: Node2Definition
  node3?: Node3Definition
  node4?: Node4Definition
  node5?: Node5Definition
  position: NodePosition
  customErrorMessage?: string
  /** Per-node error response override. null/undefined = use NODE5 defaultErrorConfig. */
  errorResponse?: NodeErrorResponse
}

export interface WorkflowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  isDashed: boolean
}

export interface WorkflowCondition {
  // Leaf condition (type is set, logicalOp is undefined)
  type?: ConditionType
  endpointPattern?: string
  fieldKey?: string
  fieldValue?: string
  containsKey?: string
  // Composite condition (logicalOp is set, type is undefined)
  logicalOp?: LogicalOp
  subConditions?: WorkflowCondition[]
  // Display
  rawExpression?: string
}

export interface WorkflowUnit {
  id: string
  name: string
  condition: WorkflowCondition
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}
