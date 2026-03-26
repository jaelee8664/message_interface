import { Node4Definition, MessageFormat, ProtocolType } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'

interface Props {
  definition: Node4Definition | undefined
  onChange: (def: Node4Definition) => void
}

const FORMAT_OPTIONS: { value: MessageFormat; label: string }[] = [
  { value: 'JSON', label: 'JSON' },
  { value: 'XML', label: 'XML' },
  { value: 'PROTOBUF', label: 'Protobuf (gRPC 전용)' },
]

const PROTOCOL_OPTIONS: { value: ProtocolType; label: string }[] = [
  { value: 'REST_SERVER', label: 'REST' },
  { value: 'WEBSOCKET_CLIENT', label: 'WebSocket 클라이언트' },
  { value: 'WEBSOCKET_SERVER', label: 'WebSocket 서버 (세션에 송신)' },
  { value: 'TCP_CLIENT', label: 'TCP 클라이언트' },
  { value: 'TCP_SERVER', label: 'TCP 서버 (연결에 송신)' },
  { value: 'GRPC_CLIENT', label: 'gRPC 클라이언트' },
  { value: 'GRPC_SERVER', label: 'gRPC 서버 (응답)' },
  { value: 'KAFKA_PUBLISHER', label: 'Kafka 발행' },
]

const DEFAULT_DEF: Node4Definition = {
  messageFormat: 'JSON',
  protocol: 'REST_SERVER',
  retryCount: 0,
  timeoutMs: 5000,
}

export default function Node4Panel({ definition, onChange }: Props) {
  const def = definition ?? DEFAULT_DEF

  const update = (partial: Partial<Node4Definition>) => onChange({ ...def, ...partial })

  const isProtobufForced = def.messageFormat === 'PROTOBUF'
  const needsTarget = ['REST_SERVER', 'WEBSOCKET_CLIENT', 'TCP_CLIENT', 'GRPC_CLIENT'].includes(def.protocol)
  const isKafka = def.protocol === 'KAFKA_PUBLISHER'

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
        options={isProtobufForced
          ? PROTOCOL_OPTIONS.filter(o => o.value === 'GRPC_CLIENT' || o.value === 'GRPC_SERVER')
          : PROTOCOL_OPTIONS}
        hint={isProtobufForced ? 'Protobuf는 gRPC만 사용 가능합니다.' : undefined}
      />

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
          <InputField
            label="대상 경로"
            value={def.targetPath ?? ''}
            onChange={(e) => update({ targetPath: e.target.value })}
            placeholder="예: /orders"
          />
        </>
      )}

      {isKafka && (
        <InputField
          label="Kafka 토픽"
          value={def.targetTopic ?? ''}
          onChange={(e) => update({ targetTopic: e.target.value })}
          placeholder="예: my-topic"
        />
      )}

      <InputField
        label="재시도 횟수"
        type="number"
        value={def.retryCount ?? 0}
        onChange={(e) => update({ retryCount: Math.max(0, Number(e.target.value)) })}
        hint="0 = 재시도 없음"
      />

      <InputField
        label="타임아웃 (ms)"
        type="number"
        value={def.timeoutMs ?? 5000}
        onChange={(e) => update({ timeoutMs: Math.max(100, Number(e.target.value)) })}
        placeholder="예: 5000"
      />
    </div>
  )
}
