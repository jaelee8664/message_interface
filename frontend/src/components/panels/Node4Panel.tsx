import { Node4Definition, MessageFormat, ProtocolType, ProtoFieldDef, ProtoMessageDef } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'
import ProtoSchemaEditor from './ProtoSchemaEditor'

interface Props {
  definition: Node4Definition | undefined
  onChange: (def: Node4Definition) => void
  unitId: string
}

const FORMAT_OPTIONS: { value: MessageFormat; label: string }[] = [
  { value: 'JSON', label: 'JSON' },
  { value: 'XML', label: 'XML' },
]

const PROTOCOL_OPTIONS: { value: ProtocolType; label: string }[] = [
  { value: 'REST_CLIENT', label: 'REST 클라이언트' },
  { value: 'WEBSOCKET_CLIENT', label: 'WebSocket 클라이언트' },
  { value: 'WEBSOCKET_SERVER', label: 'WebSocket 서버 (세션에 송신)' },
  { value: 'TCP_CLIENT', label: 'TCP 클라이언트' },
  { value: 'TCP_SERVER', label: 'TCP 서버 (연결에 송신)' },
  { value: 'KAFKA_PUBLISHER', label: 'Kafka 발행' },
  { value: 'MONGO_QUEUE_PUBLISHER', label: 'MongoDB 큐 발행' },
  { value: 'GRPC_SERVER', label: 'gRPC 서버 (수신 스트림에 응답)' },
  { value: 'GRPC_CLIENT', label: 'gRPC 클라이언트 (연결된 스트림에 송신)' },
]

const DEFAULT_DEF: Node4Definition = {
  messageFormat: 'JSON',
  protocol: 'REST_CLIENT',
  retryCount: 0,
  retryDelaySeconds: 0,
  timeoutMs: 5000,
  reconnectDelaySeconds: 5,
}

export default function Node4Panel({ definition, onChange, unitId }: Props) {
  const def = definition ?? DEFAULT_DEF

  const update = (partial: Partial<Node4Definition>) => onChange({ ...def, ...partial })

  const isXml = def.messageFormat === 'XML'
  const isGrpcServer = def.protocol === 'GRPC_SERVER'
  const isGrpcClient = def.protocol === 'GRPC_CLIENT'
  const isGrpc = isGrpcServer || isGrpcClient
  const needsTarget = ['REST_CLIENT', 'WEBSOCKET_CLIENT', 'TCP_CLIENT'].includes(def.protocol)
  const isKafka = def.protocol === 'KAFKA_PUBLISHER'
  const isMongoQueue = def.protocol === 'MONGO_QUEUE_PUBLISHER'
  const isWsClient = def.protocol === 'WEBSOCKET_CLIENT'
  const isTcpClient = def.protocol === 'TCP_CLIENT'
  const isSessionProtocol = def.protocol === 'WEBSOCKET_SERVER' || def.protocol === 'TCP_SERVER'
  const needsReconnect = isWsClient || isTcpClient
  const hasRetry = (def.retryCount ?? 0) > 0

  // WEBSOCKET_SERVER / TCP_SERVER: targetPath=null → 수신한 세션에 그대로 응답
  const replyToSelf = isSessionProtocol ? def.targetPath == null : false

  const handleReplyToSelfToggle = (checked: boolean) => {
    update({ targetPath: checked ? undefined : '' })
  }

  // GRPC_SERVER: targetPath=null → 수신한 스트림에 응답 / 설정 시 → 해당 IP의 스트림에 전송
  const grpcServerReplyToSelf = isGrpcServer ? def.targetPath == null : false

  const handleGrpcServerReplyToSelfToggle = (checked: boolean) => {
    update({ targetPath: checked ? undefined : '' })
  }

  return (
    <div className="space-y-4">
      {/* gRPC 모드: 메세지 형식 선택 숨기고 Protobuf 고정 안내 */}
      {!isGrpc && (
        <SelectField
          label="메세지 형식"
          value={def.messageFormat}
          onChange={(e) => update({ messageFormat: e.target.value as MessageFormat })}
          options={FORMAT_OPTIONS}
        />
      )}

      {isXml && (
        <InputField
          label="XML 루트 엘리먼트"
          value={def.xmlRootElement ?? ''}
          onChange={(e) => update({ xmlRootElement: e.target.value || undefined })}
          placeholder="예: Message"
          hint="XML 출력 시 최상위 태그 이름. 비우면 루트 태그 없이 직렬화됩니다."
        />
      )}

      <SelectField
        label="송신 프로토콜"
        value={def.protocol}
        onChange={(e) => update({ protocol: e.target.value as ProtocolType })}
        options={PROTOCOL_OPTIONS}
      />

      {isSessionProtocol && (
        <div className="rounded-md bg-slate-800 border border-slate-700 px-3 py-2.5 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={replyToSelf}
              onChange={(e) => handleReplyToSelfToggle(e.target.checked)}
              className="accent-cyan-500 w-3.5 h-3.5"
            />
            <span className="text-xs font-medium text-slate-200">현재 유닛으로 돌려보내기</span>
          </label>
          <p className="text-xs text-slate-500 leading-relaxed">
            이 메세지를 수신한 {def.protocol === 'WEBSOCKET_SERVER' ? 'WebSocket' : 'TCP'} 클라이언트에게 응답을 전송합니다.
          </p>
          {!replyToSelf && (
            <InputField
              label="대상 클라이언트 IP"
              value={def.targetPath ?? ''}
              onChange={(e) => update({ targetPath: e.target.value })}
              placeholder="예: 192.168.0.10"
              hint="해당 IP로 접속한 모든 클라이언트 세션에 전송합니다."
            />
          )}
        </div>
      )}

      {needsTarget && (
        <>
          <InputField
            label="대상 호스트"
            value={def.targetHost ?? ''}
            onChange={(e) => update({ targetHost: e.target.value })}
            placeholder="예: localhost"
          />
          <InputField
            label="대상 포트"
            type="number"
            value={def.targetPort ?? ''}
            onChange={(e) => update({ targetPort: Number(e.target.value) })}
            placeholder="예: 8081"
          />
          {!isTcpClient && (
            <InputField
              label="대상 경로"
              value={def.targetPath ?? ''}
              onChange={(e) => update({ targetPath: e.target.value })}
              placeholder="예: /orders"
            />
          )}
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
            label="Kafka 토픽"
            value={def.targetTopic ?? ''}
            onChange={(e) => update({ targetTopic: e.target.value })}
            placeholder="예: my-topic"
          />
        </>
      )}

      {isMongoQueue && (
        <InputField
          label="큐 이름"
          value={def.mongoQueueName ?? ''}
          onChange={(e) => update({ mongoQueueName: e.target.value })}
          placeholder="예: order-queue"
          hint="NODE0 소비 측과 동일한 이름을 입력하세요. 재시도 중 중복 발행은 자동으로 방지됩니다."
        />
      )}

      {/* gRPC 전용 설정 */}
      {isGrpc && (
        <div className="space-y-3 p-3 rounded border border-cyan-600/40 bg-cyan-900/10">
          <div className="text-xs font-semibold text-cyan-300">gRPC 송신 설정</div>

          {isGrpcServer && (
            <div className="rounded-md bg-slate-800 border border-slate-700 px-3 py-2.5 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={grpcServerReplyToSelf}
                  onChange={(e) => handleGrpcServerReplyToSelfToggle(e.target.checked)}
                  className="accent-cyan-500 w-3.5 h-3.5"
                />
                <span className="text-xs font-medium text-slate-200">현재 유닛으로 돌려보내기</span>
              </label>
              <p className="text-xs text-slate-500 leading-relaxed">
                이 메세지를 수신한 gRPC 클라이언트 스트림에 응답을 전송합니다.
              </p>
              {!grpcServerReplyToSelf && (
                <InputField
                  label="대상 클라이언트 IP"
                  value={def.targetPath ?? ''}
                  onChange={(e) => update({ targetPath: e.target.value })}
                  placeholder="예: 192.168.0.10"
                  hint="해당 IP로 연결된 모든 gRPC 스트림에 전송합니다."
                />
              )}
            </div>
          )}

          {isGrpcClient && (
            <>
              <InputField
                label="대상 서비스 이름"
                value={def.grpcServiceName ?? ''}
                onChange={(e) => update({ grpcServiceName: e.target.value || undefined })}
                placeholder="기본: MessageInterfaceService"
                hint="NODE0 GRPC_CLIENT의 서비스 이름과 일치해야 합니다."
              />
              <InputField
                label="대상 메서드 이름"
                value={def.grpcMethodName ?? ''}
                onChange={(e) => update({ grpcMethodName: e.target.value || undefined })}
                placeholder="기본: BiStream"
              />
              <InputField
                label="대상 호스트"
                value={def.targetHost ?? ''}
                onChange={(e) => update({ targetHost: e.target.value })}
                placeholder="예: localhost"
              />
              <InputField
                label="대상 포트"
                type="number"
                value={def.targetPort ?? ''}
                onChange={(e) => update({ targetPort: Number(e.target.value) })}
                placeholder="예: 9090"
              />
            </>
          )}

          {/* 출력 proto 스키마 */}
          <div className="pt-1 border-t border-slate-700/60">
            <div className="text-xs font-medium text-slate-300 mb-2">출력 메시지 Proto 스키마</div>
            <ProtoSchemaEditor
              fields={def.protoSchema ?? []}
              messages={def.protoMessages ?? []}
              onChange={(protoSchema: ProtoFieldDef[], protoMessages: ProtoMessageDef[]) =>
                update({ protoSchema, protoMessages, messageFormat: 'PROTOBUF' })}
            />
          </div>
        </div>
      )}

      <InputField
        label="재시도 횟수"
        type="number"
        value={def.retryCount ?? 0}
        onChange={(e) => update({ retryCount: Math.max(0, Number(e.target.value)) })}
        hint="0 = 재시도 없음"
      />

      {hasRetry && (
        <InputField
          label="재시도 간격 (초)"
          type="number"
          value={def.retryDelaySeconds ?? 0}
          onChange={(e) => update({ retryDelaySeconds: Math.max(0, Number(e.target.value)) })}
          hint="0 = 즉시 재시도"
        />
      )}

      <InputField
        label="타임아웃 (ms)"
        type="number"
        value={def.timeoutMs ?? 5000}
        onChange={(e) => update({ timeoutMs: Math.max(100, Number(e.target.value)) })}
        placeholder="예: 5000"
      />

      {needsReconnect && (
        <InputField
          label="재연결 대기 (초)"
          type="number"
          value={def.reconnectDelaySeconds ?? 5}
          onChange={(e) => update({ reconnectDelaySeconds: Math.max(1, Number(e.target.value)) })}
          placeholder="예: 5"
        />
      )}
    </div>
  )
}
