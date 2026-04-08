import { Node4Definition, MessageFormat, ProtocolType } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'

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
]

const DEFAULT_DEF: Node4Definition = {
  messageFormat: 'JSON',
  protocol: 'REST_CLIENT',
  retryCount: 0,
  retryDelaySeconds: 0,
  timeoutMs: 5000,
  reconnectEnabled: true,
  reconnectDelaySeconds: 5,
}

export default function Node4Panel({ definition, onChange, unitId }: Props) {
  const def = definition ?? DEFAULT_DEF

  const update = (partial: Partial<Node4Definition>) => onChange({ ...def, ...partial })

  const needsTarget = ['REST_CLIENT', 'WEBSOCKET_CLIENT', 'TCP_CLIENT'].includes(def.protocol)
  const isKafka = def.protocol === 'KAFKA_PUBLISHER'
  const isWsClient = def.protocol === 'WEBSOCKET_CLIENT'
  const isTcpClient = def.protocol === 'TCP_CLIENT'
  const isSessionProtocol = def.protocol === 'WEBSOCKET_SERVER' || def.protocol === 'TCP_SERVER'
  const needsReconnect = isWsClient || isTcpClient
  const hasRetry = (def.retryCount ?? 0) > 0

  // WEBSOCKET_SERVER / TCP_SERVER 모두 targetPath=null → 수신한 세션에 그대로 응답
  const replyToSelf = isSessionProtocol ? def.targetPath == null : false

  const handleReplyToSelfToggle = (checked: boolean) => {
    update({ targetPath: checked ? null : '' })
  }

  return (
    <div className="space-y-4">
      <SelectField
        label="메세지 형식"
        value={def.messageFormat}
        onChange={(e) => update({ messageFormat: e.target.value as MessageFormat })}
        options={FORMAT_OPTIONS}
      />

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
        <>
          <SelectField
            label="재연결"
            value={def.reconnectEnabled !== false ? 'true' : 'false'}
            onChange={(e) => update({ reconnectEnabled: e.target.value === 'true' })}
            options={[
              { value: 'true', label: '활성화' },
              { value: 'false', label: '비활성화' },
            ]}
          />
          {def.reconnectEnabled !== false && (
            <InputField
              label="재연결 대기 (초)"
              type="number"
              value={def.reconnectDelaySeconds ?? 5}
              onChange={(e) => update({ reconnectDelaySeconds: Math.max(1, Number(e.target.value)) })}
              placeholder="예: 5"
            />
          )}
        </>
      )}
    </div>
  )
}
