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
]

const CLIENT_PROTOCOLS: ProtocolType[] = ['WEBSOCKET_CLIENT', 'TCP_CLIENT']
const PING_PROTOCOLS: ProtocolType[] = ['WEBSOCKET_CLIENT', 'TCP_CLIENT']

const DEFAULT: Node0Definition = {
  protocol: 'REST_SERVER',
  pingEnabled: false,
  pingIntervalSeconds: 30,
  pongTimeoutSeconds: 10,
  idleTimeoutSeconds: 60,
  reconnectEnabled: true,
  reconnectDelaySeconds: 5,
  bidirectional: false,
}

export default function Node0Panel({ definition, onChange, condition, onConditionChange, unitId }: Props) {
  const def = definition ?? DEFAULT
  const isClient = CLIENT_PROTOCOLS.includes(def.protocol)
  const hasPing = PING_PROTOCOLS.includes(def.protocol)
  const isKafka = def.protocol === 'KAFKA_CONSUMER'
  const isRestServer = def.protocol === 'REST_SERVER'
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

      {isClient && (
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

      {isKafka && (
        <>
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
            hint="연결된 서버가 WebSocket ping/pong 프레임을 지원하는 경우에만 활성화하세요."
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
                hint="이 시간 내에 Pong이 없으면 좀비 연결로 판단하고 재연결합니다."
              />
            </>
          ) : (
            <div className="p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300 space-y-1">
              <div className="font-semibold">⚠️ Ping/Pong 비활성화 경고</div>
              <div className="text-amber-400/80 leading-relaxed">
                Ping/Pong이 비활성화된 상태입니다. 연결 끊김 감지가 불가능하므로 자동 재연결이 지연될 수 있습니다.
              </div>
              <div className="text-amber-400/80 leading-relaxed">
                대상 서버가 WebSocket ping/pong 프레임({' '}
                <span className="font-mono">opcode 0x9/0xA</span>)을 지원하지 않는 경우에만 비활성화하세요.
                지원 여부를 확인하려면 서버 문서를 참고하거나 운영자에게 문의하세요.
              </div>
            </div>
          )}
        </>
      )}

      {isClient && (
        <>
          {def.protocol === 'TCP_CLIENT' && (
            <InputField
              label="수신 Idle 타임아웃 (초)"
              type="number"
              value={def.idleTimeoutSeconds}
              onChange={(e) => update({ idleTimeoutSeconds: Number(e.target.value) })}
              hint="이 시간(초) 동안 수신 데이터가 없으면 좀비 연결로 판단하고 재연결합니다. 0 = 비활성화"
            />
          )}
          <CheckboxField
            label="자동 재연결"
            checked={def.reconnectEnabled}
            onChange={(v) => update({ reconnectEnabled: v })}
          />
          {def.reconnectEnabled && (
            <InputField
              label="재연결 대기 (초)"
              type="number"
              value={def.reconnectDelaySeconds}
              onChange={(e) => update({ reconnectDelaySeconds: Number(e.target.value) })}
            />
          )}
        </>
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
