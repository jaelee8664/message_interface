import { useState } from 'react'
import axios from 'axios'
import { WorkflowCondition, ConditionType, LogicalOp, ProtocolType } from '../types/workflow'
import { InputField } from './ui/FormField'

// Protocols that carry no endpoint — ENDPOINT condition type is meaningless for these
const NO_ENDPOINT_PROTOCOLS: ProtocolType[] = ['TCP_SERVER', 'TCP_CLIENT', 'KAFKA_CONSUMER', 'GRPC_SERVER', 'GRPC_CLIENT']

interface Props {
  condition: WorkflowCondition
  onChange: (condition: WorkflowCondition) => void
  unitId?: string
  showValidateButton?: boolean
  protocol?: ProtocolType
}

interface ConflictInfo { existing: string; new: string; reason: string }
interface ValidationResult { valid: boolean; conflicts: ConflictInfo[] }

const CONDITION_TYPE_OPTIONS: { value: ConditionType; label: string; description: string }[] = [
  { value: 'ENDPOINT',     label: 'URI Endpoint',  description: 'REST/WebSocket 요청의 경로로 구분합니다. 예: /order/{id}' },
  { value: 'FIELD_VALUE',  label: '필드 값',         description: '메세지 특정 필드의 값으로 구분합니다. 예: header.name == "OrderSystem"' },
  { value: 'CONTAINS_KEY', label: '키 포함 여부',    description: '메세지에 특정 키가 있는지로 구분합니다. 예: containsKey(header.trace_id)' },
]

// ── Expression builder ────────────────────────────────────────────────────────

export function buildRawExpression(condition: WorkflowCondition): string {
  if (condition.logicalOp && condition.subConditions) {
    const op = condition.logicalOp === 'AND' ? ' AND ' : ' OR '
    const parts = condition.subConditions.map((sub) => {
      const expr = buildRawExpression(sub)
      // wrap nested composite expressions in parentheses for clarity
      return sub.logicalOp ? `(${expr})` : expr
    })
    return parts.join(op)
  }
  switch (condition.type) {
    case 'ENDPOINT':     return `endpoint == "${condition.endpointPattern ?? ''}"`
    case 'FIELD_VALUE':  return `${condition.fieldKey ?? ''} == "${condition.fieldValue ?? ''}"`
    case 'CONTAINS_KEY': return `containsKey(${condition.containsKey ?? ''})`
    default:             return ''
  }
}

// ── Leaf condition editor (single type + fields) ───────────────────────────────

function LeafConditionEditor({
  condition,
  onChange,
  groupId,
  protocol,
}: {
  condition: WorkflowCondition
  onChange: (c: WorkflowCondition) => void
  groupId: string
  protocol?: ProtocolType
}) {
  const noEndpoint = protocol != null && NO_ENDPOINT_PROTOCOLS.includes(protocol)
  const visibleOptions = noEndpoint
    ? CONDITION_TYPE_OPTIONS.filter((o) => o.value !== 'ENDPOINT')
    : CONDITION_TYPE_OPTIONS
  const update = (partial: Partial<WorkflowCondition>) => {
    const updated = { ...condition, ...partial }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="space-y-1.5">
        {visibleOptions.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-2.5 rounded border cursor-pointer transition-colors ${
              condition.type === opt.value
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-slate-600 bg-slate-800 hover:border-slate-500'
            }`}
          >
            <input
              type="radio"
              name={`conditionType-${groupId}`}
              value={opt.value}
              checked={condition.type === opt.value}
              onChange={() => update({ type: opt.value as ConditionType })}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-white">{opt.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Type-specific inputs */}
      {condition.type === 'ENDPOINT' && (
        <InputField
          label="엔드포인트 패턴"
          value={condition.endpointPattern ?? ''}
          onChange={(e) => update({ endpointPattern: e.target.value })}
          placeholder="예: /order/{id}"
          hint="/order/{id}와 /order/{name}은 교집합입니다."
        />
      )}
      {condition.type === 'FIELD_VALUE' && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <InputField
              label="필드 키 (dot-notation)"
              value={condition.fieldKey ?? ''}
              onChange={(e) => update({ fieldKey: e.target.value })}
              placeholder="예: header.name"
            />
          </div>
          <div className="text-slate-400 pb-2 text-sm">=</div>
          <div className="flex-1">
            <InputField
              label="값"
              value={condition.fieldValue ?? ''}
              onChange={(e) => update({ fieldValue: e.target.value })}
              placeholder="예: OrderSystem"
            />
          </div>
        </div>
      )}
      {condition.type === 'CONTAINS_KEY' && (
        <InputField
          label="키 이름"
          value={condition.containsKey ?? ''}
          onChange={(e) => update({ containsKey: e.target.value })}
          placeholder="예: header.trace_id"
          hint="이 키가 메세지에 존재하는지 확인합니다."
        />
      )}
    </div>
  )
}

// ── Default sub-condition ─────────────────────────────────────────────────────

function makeDefaultLeaf(protocol?: ProtocolType): WorkflowCondition {
  const noEndpoint = protocol != null && NO_ENDPOINT_PROTOCOLS.includes(protocol)
  return noEndpoint
    ? { type: 'FIELD_VALUE', fieldKey: '', fieldValue: '' }
    : { type: 'ENDPOINT', endpointPattern: '' }
}

// ── Recursive condition node (supports nesting) ───────────────────────────────

function ConditionNode({
  condition,
  onChange,
  groupId,
  protocol,
}: {
  condition: WorkflowCondition
  onChange: (c: WorkflowCondition) => void
  groupId: string
  protocol?: ProtocolType
}) {
  const isComposite = !!condition.logicalOp

  const switchToSimple = () => {
    if (isComposite && !window.confirm('복합 조건을 단순 조건으로 전환하면 하위 조건이 모두 삭제됩니다. 계속하시겠습니까?')) return
    onChange({ ...makeDefaultLeaf(protocol), rawExpression: '' })
  }

  const switchToComposite = (op: LogicalOp) => {
    const subs: WorkflowCondition[] = condition.subConditions?.length
      ? condition.subConditions
      : [makeDefaultLeaf(protocol), makeDefaultLeaf(protocol)]
    const updated: WorkflowCondition = { logicalOp: op, subConditions: subs }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  const changeLogicalOp = (op: LogicalOp) => {
    const updated: WorkflowCondition = { ...condition, logicalOp: op }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  const updateSubCondition = (index: number, sub: WorkflowCondition) => {
    const subs = [...(condition.subConditions ?? [])]
    subs[index] = sub
    const updated: WorkflowCondition = { ...condition, subConditions: subs }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  const addSubCondition = () => {
    const subs = [...(condition.subConditions ?? []), makeDefaultLeaf(protocol)]
    const updated: WorkflowCondition = { ...condition, subConditions: subs }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  const removeSubCondition = (index: number) => {
    const subs = (condition.subConditions ?? []).filter((_, i) => i !== index)
    const updated: WorkflowCondition = { ...condition, subConditions: subs }
    updated.rawExpression = buildRawExpression(updated)
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle: simple / composite */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={switchToSimple}
          className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
            !isComposite
              ? 'border-blue-500 bg-blue-500/15 text-blue-300'
              : 'border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500'
          }`}
        >
          단순 조건
        </button>
        <button
          type="button"
          onClick={() => switchToComposite(condition.logicalOp ?? 'AND')}
          className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
            isComposite
              ? 'border-purple-500 bg-purple-500/15 text-purple-300'
              : 'border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500'
          }`}
        >
          AND / OR 복합 조건
        </button>
      </div>

      {/* Simple mode */}
      {!isComposite && (
        <LeafConditionEditor condition={condition} onChange={onChange} groupId={groupId} protocol={protocol} />
      )}

      {/* Composite mode */}
      {isComposite && (
        <div className="space-y-2">
          {/* AND / OR toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">논리 연산자:</span>
            {(['AND', 'OR'] as LogicalOp[]).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => changeLogicalOp(op)}
                className={`px-3 py-1 text-xs rounded border font-mono font-semibold transition-colors ${
                  condition.logicalOp === op
                    ? op === 'AND'
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                      : 'border-orange-500 bg-orange-500/20 text-orange-300'
                    : 'border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500'
                }`}
              >
                {op}
              </button>
            ))}
          </div>

          {/* Sub-conditions — recursive */}
          {(condition.subConditions ?? []).map((sub, i) => (
            <div key={i} className="relative p-3 rounded border border-slate-600 bg-slate-800/50 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-400">조건 {i + 1}</span>
                {(condition.subConditions?.length ?? 0) > 2 && (
                  <button
                    type="button"
                    onClick={() => removeSubCondition(i)}
                    className="text-xs text-slate-500 hover:text-red-400 px-1"
                  >
                    삭제
                  </button>
                )}
              </div>
              <ConditionNode
                condition={sub}
                onChange={(updated) => updateSubCondition(i, updated)}
                groupId={`${groupId}-${i}`}
                protocol={protocol}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={addSubCondition}
            className="w-full py-1.5 text-xs rounded border border-dashed border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-300 transition-colors"
          >
            + 조건 추가
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main ConditionEditor ──────────────────────────────────────────────────────

export default function ConditionEditor({ condition, onChange, unitId, showValidateButton = true, protocol }: Props) {
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  const handleChange = (updated: WorkflowCondition) => {
    onChange(updated)
    setValidationResult(null)
  }

  const validate = async () => {
    setValidating(true)
    setValidationResult(null)
    try {
      const res = await axios.post('/synapse/workflow/condition/validate', { unitId: unitId ?? null, condition })
      setValidationResult(res.data.data)
    } catch (e: any) {
      setValidationResult({ valid: false, conflicts: [{ existing: '', new: '', reason: e.message }] })
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Warning */}
      <div className="p-3 rounded border border-amber-500/50 bg-amber-500/10 text-xs text-amber-300">
        <div className="font-semibold mb-1">⚠️ 조건 교집합 금지</div>
        <div className="text-amber-400/80">
          워크플로우 단위의 조건들 사이에 교집합이 있으면 안됩니다. 동일한 메세지가 두 개 이상의 단위에 매칭되면 오류가 발생합니다.
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-300">조건 모드</label>
        <ConditionNode condition={condition} onChange={handleChange} groupId="root" protocol={protocol} />
      </div>

      {/* Expression preview */}
      {condition.rawExpression && (
        <div className="px-3 py-2 rounded bg-slate-800 border border-slate-600 font-mono text-xs text-blue-300 break-all">
          {condition.rawExpression}
        </div>
      )}

      {/* Validate button + result */}
      {showValidateButton && (
        <div>
          <button
            onClick={validate}
            disabled={validating}
            className="px-4 py-2 text-sm rounded border border-blue-500 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
          >
            {validating ? '검증 중...' : '조건 교집합 검증'}
          </button>

          {validationResult && (
            <div className={`mt-2 p-3 rounded text-xs ${
              validationResult.valid
                ? 'bg-green-500/10 border border-green-500/50 text-green-300'
                : 'bg-red-500/10 border border-red-500/50 text-red-300'
            }`}>
              {validationResult.valid ? (
                <div className="font-semibold">✓ 조건이 유효합니다. 교집합이 없습니다.</div>
              ) : (
                <>
                  <div className="font-semibold mb-2">✕ 조건 교집합이 감지되었습니다:</div>
                  {validationResult.conflicts.map((c, i) => (
                    <div key={i} className="mb-1">
                      <span className="text-red-400">[{c.existing}]</span>
                      <span className="text-slate-400 mx-1">vs</span>
                      <span className="text-red-400">[{c.new}]</span>
                      <div className="text-slate-400 ml-2">→ {c.reason}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
