import { useState } from 'react'
import { VariableExtraction } from '../../types/workflow'

interface Props {
  extractions: VariableExtraction[]
  onChange: (extractions: VariableExtraction[]) => void
}

export function VariableExtractionSection({ extractions, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const add = () => onChange([...extractions, { fieldPath: '', variableName: '' }])

  const update = (idx: number, partial: Partial<VariableExtraction>) => {
    onChange(extractions.map((e, i) => (i === idx ? { ...e, ...partial } : e)))
  }

  const remove = (idx: number) => onChange(extractions.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="w-full flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span>세션 변수 추출 {extractions.length > 0 && <span className="text-cyan-400">({extractions.length})</span>}</span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 leading-relaxed">
            <span className="text-slate-300 font-medium">세션 변수</span>란 하나의 메시지 처리 흐름(세션) 동안 유지되는 임시 값입니다.
            이 노드 통과 시 지정한 메시지 필드 값을 변수로 저장하며, 이후 NODE4 대상 호스트·포트, NODE5 응답 필드에서{' '}
            <span className="text-cyan-400 font-mono">${'{'}변수명{'}'}</span> 형식으로 참조할 수 있습니다.
            세션이 끝나면 자동으로 소멸됩니다.
          </p>

          {extractions.length === 0 && (
            <p className="text-xs text-slate-600 italic">추출 규칙이 없습니다.</p>
          )}

          {extractions.map((e, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                type="text"
                className="flex-1 px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                value={e.fieldPath}
                onChange={(ev) => update(idx, { fieldPath: ev.target.value })}
                placeholder="필드 경로 (예: header.srcIp)"
              />
              <span className="text-slate-500 text-xs shrink-0">→</span>
              <input
                type="text"
                className="flex-1 px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono uppercase"
                value={e.variableName}
                onChange={(ev) => update(idx, { variableName: ev.target.value.toUpperCase() })}
                placeholder="변수명 (예: SRC_IP)"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-red-400 hover:text-red-300 text-xs px-1 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={add}
            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600"
          >
            + 추가
          </button>
        </div>
      )}
    </div>
  )
}
