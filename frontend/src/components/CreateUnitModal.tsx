import { useState } from 'react'
import { WorkflowCondition } from '../types/workflow'
import { useWorkflowStore } from '../store/workflowStore'
import { createDefaultWorkflowUnit } from '../utils/defaultWorkflowUnit'
import ConditionEditor from './ConditionEditor'
import axios from 'axios'

interface Props {
  onClose: () => void
}

type Step = 'info' | 'confirm'

const DEFAULT_CONDITION: WorkflowCondition = {
  type: 'ENDPOINT',
  endpointPattern: '',
  rawExpression: '',
}

export default function CreateUnitModal({ onClose }: Props) {
  const { saveUnit, selectUnit } = useWorkflowStore()

  const [step, setStep] = useState<Step>('info')
  const [name, setName] = useState('')
  const [condition, setCondition] = useState<WorkflowCondition>(DEFAULT_CONDITION)
  const [modifiedBy, setModifiedBy] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)

  const isLeafFilled = (c: WorkflowCondition): boolean => {
    switch (c.type) {
      case 'ENDPOINT':     return !!c.endpointPattern
      case 'FIELD_VALUE':  return !!c.fieldKey && !!c.fieldValue
      case 'CONTAINS_KEY': return !!c.containsKey
      default:             return false
    }
  }

  const isConditionFilled = (): boolean => {
    if (condition.logicalOp) {
      if (!condition.subConditions || condition.subConditions.length < 2) return false
      return condition.subConditions.every(isLeafFilled)
    }
    return isLeafFilled(condition)
  }

  const handleNext = async () => {
    if (!name.trim()) { setError('워크플로우 단위 이름을 입력해 주세요.'); return }
    if (!isConditionFilled()) { setError('조건을 완전히 입력해 주세요.'); return }
    setError(null)

    // Validate condition before proceeding
    setValidating(true)
    try {
      const res = await axios.post('/synapse/workflow/condition/validate', {
        unitId: null,
        condition,
      })
      const result = res.data.data
      if (!result.valid) {
        const msgs = result.conflicts.map((c: any) => `[${c.existing}] vs [${c.new}]: ${c.reason}`).join('\n')
        setError(`조건 교집합이 감지되었습니다:\n${msgs}`)
        setValidating(false)
        return
      }
      setStep('confirm')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setValidating(false)
    }
  }

  const handleCreate = async () => {
    if (!modifiedBy.trim()) { setError('수정자 이름을 입력해 주세요.'); return }
    if (!password) { setError('비밀번호를 입력해 주세요.'); return }
    setError(null)
    setSaving(true)

    try {
      const unit = createDefaultWorkflowUnit(name, condition)
      await saveUnit(unit, modifiedBy, password)
      selectUnit(unit.id)
      onClose()
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg bg-slate-900 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div>
              <div className="text-xs text-slate-400">
                {step === 'info' ? '1단계 / 2' : '2단계 / 2'}
              </div>
              <div className="text-base font-semibold text-white">
                {step === 'info' ? '새 워크플로우 단위 생성' : '생성 확인'}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {step === 'info' && (
              <>
                {/* Unit name */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-300">워크플로우 단위 이름</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setError(null) }}
                    placeholder="예: 주문 처리 워크플로우"
                    className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                </div>

                {/* Condition editor */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-3">구분 조건</div>
                  <ConditionEditor
                    condition={condition}
                    onChange={setCondition}
                    unitId={undefined}
                    showValidateButton={false}
                  />
                </div>
              </>
            )}

            {step === 'confirm' && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="p-4 rounded-lg bg-slate-800 border border-slate-700 space-y-3">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">단위 이름</div>
                    <div className="text-sm font-semibold text-white">{name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">조건</div>
                    <div className="font-mono text-sm text-blue-300">{condition.rawExpression}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">생성될 노드</div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="px-2 py-1 rounded text-xs bg-blue-900/50 border border-blue-700/50 text-blue-300">NODE0 수신 프로토콜</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">
                      생성 후 캔버스에서 <strong className="text-slate-400">+ 노드 추가</strong> 버튼으로 NODE1~NODE5를 자유롭게 추가하고 엣지로 연결하세요.
                    </p>
                  </div>
                </div>

                {/* Auth */}
                <div className="space-y-3">
                  <div className="text-xs font-medium text-slate-300">저장 인증</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={modifiedBy}
                      onChange={(e) => { setModifiedBy(e.target.value); setError(null) }}
                      placeholder="수정자 이름"
                      className="flex-1 px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(null) }}
                      placeholder="비밀번호"
                      className="flex-1 px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-3 rounded bg-red-500/10 border border-red-500/50 text-xs text-red-300 whitespace-pre-line">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-5 py-4 border-t border-slate-700">
            {step === 'info' && (
              <>
                <button onClick={onClose} className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white">
                  취소
                </button>
                <button
                  onClick={handleNext}
                  disabled={validating}
                  className="flex-1 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                >
                  {validating ? '조건 검증 중...' : '다음'}
                </button>
              </>
            )}
            {step === 'confirm' && (
              <>
                <button onClick={() => setStep('info')} className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white">
                  이전
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex-1 py-2 text-sm rounded bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50"
                >
                  {saving ? '생성 중...' : '워크플로우 단위 생성'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
