import { Node0Definition, ProtocolType, WorkflowCondition } from '../../types/workflow'
import { InputField, SelectField, CheckboxField } from '../ui/FormField'
import ConditionEditor from '../ConditionEditor'

interface Props {
  definition: Node0Definition | undefined
  onChange: (def: Node0Definition) => void
  condition?: WorkflowCondition
  onConditionChange?: (c: WorkflowCondition) => void
  unitId?: string
}

const PROTOCOL_OPTIONS: { value: ProtocolType; label: string }[] = [
  { value: 'WEBSOCKET_SERVER', label: 'WebSocket 서버' },
  { value: 'WEBSOCKET_CLIENT', label: 'WebSocket 클라이언트' },
  { value: 'TCP_SERVER', label: 'TCP 서버' },
  { value: 'TCP_CLIENT', label: 'TCP 클라이언트' },
  { value: 'KAFKA_CONSUMER', label: 'Kafka Consumer' },
  { value: 'REST_SERVER', label: 'REST 서버' },
  { value: 'MONGO_QUEUE_CONSUMER', label: 'MongoDB 큐 소비 (폴링 응답)' },
  { value: 'GRPC_SERVER', label: 'gRPC 서버 (Bidirectional Streaming)' },
  { value: 'GRPC_CLIENT', label: 'gRPC 클라이언트 (Bidirectional Streaming)' },
]

const CLIENT_PROTOCOLS: ProtocolType[] = ['WEBSOCKET_CLIENT', 'TCP_CLIENT', 'GRPC_CLIENT']
const PING_PROTOCOLS: ProtocolType[] = ['WEBSOCKET_CLIENT', 'GRPC_CLIENT']
const GRPC_PROTOCOLS: ProtocolType[] = ['GRPC_SERVER', 'GRPC_CLIENT']

const DEFAULT: Node0Definition = {
  protocol: 'REST_SERVER',
  pingEnabled: false,
  pingIntervalSeconds: 30,
  pongTimeoutSeconds: 10,
  reconnectDelaySeconds: 5,
  bidirectional: false,
}

export default function Node0Panel({ definition, onChange, condition, onConditionChange, unitId }: Props) {
  const def = definition ?? DEFAULT
  const isClient = CLIENT_PROTOCOLS.includes(def.protocol)
  const hasPing = PING_PROTOCOLS.includes(def.protocol)
  const isKafka = def.protocol === 'KAFKA_CONSUMER'
  const isRestServer = def.protocol === 'REST_SERVER'
  const isTcpServer = def.protocol === 'TCP_SERVER'
  const isMongoQueueConsumer = def.protocol === 'MONGO_QUEUE_CONSUMER'
  const isGrpc = GRPC_PROTOCOLS.includes(def.protocol)
  const isGrpcClient = def.protocol === 'GRPC_CLIENT'
  const restPathReserved = isRestServer && (def.path?.startsWith('/synapse/') ?? false)

  const update = (partial: Partial<Node0Definition>) => onChange({ ...def, ...partial })

  return (
    <div className="space-y-4">
      <SelectField
        label="프로토콜"
        value={def.protocol}
        onChange={(e) => update({ protocol: e.target.value as ProtocolType })}
        options={PROTOCOL_OPTIONS}
      />

      {/* gRPC 공통: 서비스명 / 메서드명 */}
      {isGrpc && (
        <>
          <div className="p-2.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-300 leading-relaxed space-y-1">
            {isGrpcClient ? (
              <span>gRPC 클라이언트는 Spring HTTP 포트와 별도로 동작합니다.</span>
            ) : (
              <>
                <div>gRPC 서버 포트는 <code className="bg-cyan-900/50 px-1 rounded">application.yaml</code>의 <code className="bg-cyan-900/50 px-1 rounded">grpc.server.port</code>로 설정합니다. (기본: 9090)</div>
                <div className="text-cyan-400/70">HTTP/2 keepAlive(Ping/Pong) 설정은 <span className="text-cyan-300 font-semibold">기준정보 페이지 → gRPC 서버</span> 섹션에서 관리합니다.</div>
              </>
            )}
          </div>
          <InputField
            label="서비스 이름"
            value={def.grpcServiceName ?? ''}
            onChange={(e) => update({ grpcServiceName: e.target.value || undefined })}
            placeholder="기본: MessageInterfaceService"
            hint="외부 클라이언트의 .proto 파일에 정의된 서비스 이름과 일치해야 합니다."
          />
          <InputField
            label="메서드 이름"
            value={def.grpcMethodName ?? ''}
            onChange={(e) => update({ grpcMethodName: e.target.value || undefined })}
            placeholder="기본: BiStream"
          />
          {isGrpcClient && (
            <InputField
              label="대상 포트 (원격 gRPC 서버)"
              type="number"
              value={def.port ?? ''}
              onChange={(e) => update({ port: Number(e.target.value) })}
              placeholder="예: 9090"
              hint="연결할 원격 gRPC 서버 포트"
            />
          )}
        </>
      )}

      {/* gRPC 클라이언트: 대상 호스트 */}
      {isGrpcClient && (
        <InputField
          label="대상 호스트"
          value={def.host ?? ''}
          onChange={(e) => update({ host: e.target.value })}
          placeholder="예: localhost"
        />
      )}

      {/* WebSocket / TCP 클라이언트 */}
      {isClient && !isGrpc && (
        <>
          <InputField
            label="호스트"
            value={def.host ?? ''}
            onChange={(e) => update({ host: e.target.value })}
            placeholder="예: localhost"
          />
          <InputField
            label="포트"
            type="number"
            value={def.port ?? ''}
            onChange={(e) => update({ port: Number(e.target.value) })}
            placeholder="예: 8080"
          />
        </>
      )}

      {(def.protocol === 'WEBSOCKET_CLIENT' || def.protocol === 'WEBSOCKET_SERVER') && (
        <InputField
          label="경로"
          value={def.path ?? ''}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="예: /ws/orders"
        />
      )}

      {def.protocol === 'WEBSOCKET_SERVER' && (
        <div className="p-2.5 rounded border border-slate-600/50 bg-slate-800/50 text-xs text-slate-400 leading-relaxed">
          Ping/Pong 설정은 <span className="text-slate-300 font-semibold">기준정보 페이지 → WebSocket 서버</span> 섹션에서 관리합니다.
        </div>
      )}

      {isTcpServer && (
        <div className="p-2.5 rounded border border-slate-600/50 bg-slate-800/50 text-xs text-slate-400 leading-relaxed">
          유휴 연결 타임아웃 설정은 <span className="text-slate-300 font-semibold">기준정보 페이지 → TCP 서버</span> 섹션에서 관리합니다.
        </div>
      )}

      {isRestServer && (
        <>
          <InputField
            label="Endpoint 경로"
            value={def.path ?? ''}
            onChange={(e) => update({ path: e.target.value })}
            placeholder="예: /orders"
          />
          {restPathReserved && (
            <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-400">
              <span className="font-semibold">/synapse/</span> 로 시작하는 경로는 내부 예약 경로입니다. 다른 경로를 사용하세요.
            </div>
          )}
        </>
      )}

      {isMongoQueueConsumer && (
        <>
          <InputField
            label="폴링 수신 경로"
            value={def.path ?? ''}
            onChange={(e) => update({ path: e.target.value })}
            placeholder="예: /queue/orders"
            hint="외부 클라이언트가 GET 요청으로 이 경로를 호출하면 큐에서 메세지를 1건 꺼내 반환합니다."
          />
          <InputField
            label="큐 이름"
            value={def.mongoQueueName ?? ''}
            onChange={(e) => update({ mongoQueueName: e.target.value })}
            placeholder="예: order-queue"
            hint="NODE4 발행 측과 동일한 이름을 입력하세요."
          />
          <InputField
            label="최대 재시도 횟수"
            type="number"
            value={def.mongoQueueMaxRetries ?? 3}
            onChange={(e) => update({ mongoQueueMaxRetries: Math.max(0, Number(e.target.value)) })}
            hint="파이프라인 처리 실패 시 PENDING 복구 최대 횟수. 초과 시 FAILED 처리됩니다."
          />
          <div className="p-3 rounded border border-sky-500/30 bg-sky-500/10 text-xs text-sky-300 space-y-1">
            <div className="font-semibold">ℹ️ 전달 보장</div>
            <div className="text-sky-400/80 leading-relaxed">
              메세지는 PROCESSING 상태로 락을 취득한 뒤 처리됩니다. 연결이 끊기면 60초 후 PENDING으로 자동 복구되어 재소비됩니다. 응답 헤더 <code className="bg-sky-900/50 px-1 rounded">X-Queue-Message-Id</code>로 중복 수신 여부를 클라이언트에서 확인할 수 있습니다.
            </div>
          </div>
          <div className="p-3 rounded border border-slate-600/50 bg-slate-800/50 text-xs text-slate-300 space-y-1.5">
            <div className="font-semibold text-slate-200">GET 응답 동작</div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 font-mono text-amber-400">204</span>
              <span className="text-slate-400">큐에 PENDING 메세지가 없을 때 — body 없음</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 font-mono text-emerald-400">200</span>
              <span className="text-slate-400">메세지를 꺼내 파이프라인 처리 성공 — NODE5 설정 body 반환</span>
            </div>
          </div>
        </>
      )}

      {isKafka && (
        <>
          <InputField
            label="Bootstrap Servers"
            value={def.bootstrapServers ?? ''}
            onChange={(e) => update({ bootstrapServers: e.target.value })}
            placeholder="예: localhost:9092"
            hint="분산 서버 시: broker1:9092,broker2:9092,broker3:9092"
          />
          <InputField
            label="Topic"
            value={def.topic ?? ''}
            onChange={(e) => update({ topic: e.target.value })}
            placeholder="예: order-events"
          />
          <InputField
            label="Consumer Group ID"
            value={def.groupId ?? ''}
            onChange={(e) => update({ groupId: e.target.value })}
            placeholder="예: message-interface-group"
          />
        </>
      )}

      {hasPing && (
        <>
          <CheckboxField
            label="Ping/Pong 활성화"
            checked={def.pingEnabled}
            onChange={(v) => update({ pingEnabled: v })}
            hint={
              def.protocol === 'WEBSOCKET_SERVER'
                ? "주기적으로 Ping을 전송해 연결된 클라이언트의 좀비 연결을 감지하고 세션을 정리합니다."
                : def.protocol === 'GRPC_SERVER'
                ? "HTTP/2 keepAlive PING을 활성화합니다. 클라이언트 무응답 시 스트림을 종료합니다. (동일 포트를 공유하는 모든 gRPC 서비스에 일괄 적용됩니다)"
                : def.protocol === 'GRPC_CLIENT'
                ? "HTTP/2 keepAlive PING을 활성화합니다. 서버 무응답 시 연결을 끊고 재연결합니다."
                : "주기적으로 Ping을 전송해 서버 연결 상태를 확인하고 끊어진 경우 재연결합니다."
            }
          />
          {def.pingEnabled ? (
            <>
              <InputField
                label="Ping 간격 (초)"
                type="number"
                value={def.pingIntervalSeconds}
                onChange={(e) => update({ pingIntervalSeconds: Number(e.target.value) })}
              />
              <InputField
                label="Pong 응답 대기 (초)"
                type="number"
                value={def.pongTimeoutSeconds}
                onChange={(e) => update({ pongTimeoutSeconds: Number(e.target.value) })}
                hint={
                  def.protocol === 'WEBSOCKET_SERVER'
                    ? "이 시간 내에 Pong이 없으면 좀비 연결로 판단하고 세션을 종료합니다."
                    : def.protocol === 'GRPC_SERVER'
                    ? "이 시간 내에 PING ACK가 없으면 클라이언트 무응답으로 판단하고 스트림을 종료합니다."
                    : def.protocol === 'GRPC_CLIENT'
                    ? "이 시간 내에 PING ACK가 없으면 서버 무응답으로 판단하고 연결을 종료합니다."
                    : "이 시간 내에 Pong이 없으면 좀비 연결로 판단하고 재연결합니다."
                }
              />
            </>
          ) : (
            <div className="p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300 space-y-1">
              <div className="font-semibold">⚠️ Ping/Pong 비활성화 경고</div>
              <div className="text-amber-400/80 leading-relaxed">
                {def.protocol === 'WEBSOCKET_SERVER'
                  ? 'Ping/Pong이 비활성화된 상태입니다. 클라이언트가 비정상 종료되어도 감지할 수 없어 좀비 세션이 남을 수 있습니다.'
                  : def.protocol === 'GRPC_SERVER'
                  ? 'HTTP/2 keepAlive가 비활성화된 상태입니다. 클라이언트 무응답 감지가 불가능하므로 좀비 스트림이 남을 수 있습니다.'
                  : def.protocol === 'GRPC_CLIENT'
                  ? 'HTTP/2 keepAlive가 비활성화된 상태입니다. 서버 무응답 감지가 불가능하므로 재연결이 지연될 수 있습니다.'
                  : 'Ping/Pong이 비활성화된 상태입니다. 연결 끊김 감지가 불가능하므로 자동 재연결이 지연될 수 있습니다.'}
              </div>
            </div>
          )}
        </>
      )}

      {(isClient || isGrpcClient) && (
        <InputField
          label="재연결 대기 (초)"
          type="number"
          value={def.reconnectDelaySeconds}
          onChange={(e) => update({ reconnectDelaySeconds: Number(e.target.value) })}
        />
      )}

      {condition && onConditionChange && (
        <div className="pt-4 border-t border-slate-700/60 space-y-3">
          <div className="text-xs font-semibold text-slate-300">워크플로우 구분 조건</div>
          <p className="text-xs text-slate-500 -mt-1">
            이 조건은 수신된 메세지를 이 워크플로우 단위로 라우팅할지 결정합니다.
          </p>
          <ConditionEditor
            condition={condition}
            onChange={onConditionChange}
            unitId={unitId}
            showValidateButton={true}
            protocol={def.protocol}
          />
        </div>
      )}
    </div>
  )
}
