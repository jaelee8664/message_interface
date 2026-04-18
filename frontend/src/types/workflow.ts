export type MessageFormat = 'JSON' | 'XML' | 'PROTOBUF'
export type ProtocolType =
  | 'WEBSOCKET_SERVER' | 'WEBSOCKET_CLIENT'
  | 'TCP_SERVER' | 'TCP_CLIENT'
  | 'KAFKA_CONSUMER' | 'KAFKA_PUBLISHER'
  | 'REST_SERVER' | 'REST_CLIENT'
  | 'MONGO_QUEUE_CONSUMER' | 'MONGO_QUEUE_PUBLISHER'
  | 'GRPC_SERVER' | 'GRPC_CLIENT'

// ── Protobuf 스키마 ──────────────────────────────────────────────────────────

export type ProtoFieldType =
  | 'STRING' | 'INT32' | 'INT64' | 'FLOAT' | 'DOUBLE' | 'BOOL' | 'BYTES'
  | 'UINT32' | 'UINT64' | 'SINT32' | 'SINT64'

export type ProtoFieldLabel = 'OPTIONAL' | 'REPEATED'

export interface ProtoFieldDef {
  number: number
  name: string
  type: ProtoFieldType
  label: ProtoFieldLabel
  messageTypeName?: string   // non-null → MESSAGE 타입 필드 (type 필드는 무시됨)
}

export interface ProtoMessageDef {
  name: string
  fields: ProtoFieldDef[]
}

export type FieldType = 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN' | 'LIST' | 'MAP' | 'CUSTOM'
export type NodeType = 'NODE0' | 'NODE1' | 'NODE2' | 'NODE3' | 'NODE4' | 'NODE5'
export type ConditionType = 'ENDPOINT' | 'FIELD_VALUE' | 'CONTAINS_KEY'
export type LogicalOp = 'AND' | 'OR'
export type FieldOperator = 'EQ' | 'NEQ'
export type KeyOperator = 'EXISTS' | 'NOT_EXISTS'

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
  bootstrapServers?: string
  pingEnabled: boolean
  pingIntervalSeconds: number
  pongTimeoutSeconds: number
  reconnectDelaySeconds: number
  bidirectional: boolean
  tcpIdleTimeoutSeconds?: number
  // MONGO_QUEUE_CONSUMER 전용
  mongoQueueName?: string
  mongoQueueMaxRetries?: number
  // gRPC 전용 (GRPC_SERVER / GRPC_CLIENT)
  grpcServiceName?: string
  grpcMethodName?: string
}

export interface VariableExtraction {
  fieldPath: string      // dot-notation: "header.srcIp"
  variableName: string   // 저장할 이름: "SRC_IP"
}

export interface Node1Definition {
  messageFormat: MessageFormat
  fields: FieldDefinition[]
  customDtos: Array<{ name: string; fields: FieldDefinition[] }>
  // gRPC 전용: proto 스키마 (messageFormat == 'PROTOBUF' 일 때 사용)
  protoSchema?: ProtoFieldDef[]
  protoMessages?: ProtoMessageDef[]   // 중첩 MESSAGE 타입 정의
  variableExtractions?: VariableExtraction[]
}

export interface ValueReplaceRule { key: string; matchValue: string; afterValue: string }
export interface TypeConvertRule { key: string; beforeType: FieldType; afterType: FieldType }
export interface CustomCodeRule { key: string; code: string; afterType?: FieldType }

export interface Node2Definition {
  valueReplaceRules: ValueReplaceRule[]
  typeConvertRules: TypeConvertRule[]
  customCodeRules: CustomCodeRule[]
  variableExtractions?: VariableExtraction[]
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
  bootstrapServers?: string
  retryCount?: number
  retryDelaySeconds?: number
  timeoutMs?: number
  reconnectDelaySeconds?: number
  // MONGO_QUEUE_PUBLISHER 전용
  mongoQueueName?: string
  // XML 직렬화 전용: 출력 메시지의 루트 엘리먼트 이름
  xmlRootElement?: string
  // gRPC 전용
  grpcServiceName?: string
  grpcMethodName?: string
  protoSchema?: ProtoFieldDef[]
  protoMessages?: ProtoMessageDef[]   // 중첩 MESSAGE 타입 정의
  // 세션 변수 템플릿: ${VAR_NAME} 형식으로 런타임 치환
  targetHostExpr?: string   // targetHost 대신 사용 (변수 참조 시)
  targetPortExpr?: string   // targetPort 대신 사용 (변수 참조 시)
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
  /** true이면 fields 설정을 무시하고 파이프라인이 만들어 온 currentMap 전체를 직렬화하여 반환한다. */
  passCurrentMap?: boolean
  // XML 직렬화 전용: 응답 메시지의 루트 엘리먼트 이름
  xmlRootElement?: string
}

// ── Per-node error response ───────────────────────────────────────────────────

/** Where the runtime value for an error response field comes from. */
export type NodeErrorFieldSource = 'LITERAL' | 'FROM_MAP' | 'EXCEPTION_MESSAGE' | 'FROM_SESSION_VAR'

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
  fieldOperator?: FieldOperator
  fieldValue?: string
  containsKey?: string
  containsKeyOperator?: KeyOperator
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
