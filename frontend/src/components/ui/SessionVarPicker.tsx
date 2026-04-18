import { useState, useRef, useEffect } from 'react'
import { VariableExtraction } from '../../types/workflow'

export interface SessionVar {
  variableName: string
  fieldPath: string
  fromNode: 'NODE1' | 'NODE2'
}

interface PickerProps {
  sessionVars: SessionVar[]
  onSelect: (varName: string) => void
}

/**
 * 버튼 클릭 시 세션 변수 목록을 팝오버로 표시.
 * 변수를 선택하면 onSelect에 변수명을 전달.
 */
export function SessionVarPickerButton({ sessionVars, onSelect }: PickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-300 whitespace-nowrap"
        title="세션 변수 삽입"
      >
        변수 삽입 ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded border border-slate-600 bg-slate-800 shadow-xl">
          {sessionVars.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-400 leading-relaxed">
              <p className="font-medium text-slate-300 mb-1">추출된 세션 변수 없음</p>
              <p>NODE1 또는 NODE2 패널의 "변수 추출" 섹션에서 필드를 변수로 저장할 수 있습니다.</p>
            </div>
          ) : (
            <div className="py-1">
              <div className="px-3 py-1 text-xs text-slate-500 border-b border-slate-700">세션 변수 선택</div>
              {sessionVars.map((v) => (
                <button
                  key={v.variableName}
                  type="button"
                  onClick={() => { onSelect(v.variableName); setOpen(false) }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors"
                >
                  <div className="text-xs font-mono text-cyan-300">{`\${${v.variableName}}`}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{v.fromNode} · {v.fieldPath}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 세션 변수 선택 드롭다운 (NODE5 필드 소스용).
 * select 엘리먼트 대신 사용하며 선택 시 변수명을 value로 설정.
 */
export function SessionVarSelect({
  sessionVars,
  value,
  onChange,
}: {
  sessionVars: SessionVar[]
  value: string
  onChange: (varName: string) => void
}) {
  return (
    <select
      className="w-full px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">-- 변수 선택 --</option>
      {sessionVars.map((v) => (
        <option key={v.variableName} value={v.variableName}>
          {v.variableName} ({v.fromNode} · {v.fieldPath})
        </option>
      ))}
    </select>
  )
}

/** WorkflowUnit의 NODE1/NODE2 definition에서 SessionVar 목록을 추출하는 헬퍼 */
export function deriveSessionVars(nodes: Array<{
  nodeType: string
  node1?: { variableExtractions?: VariableExtraction[] } | null
  node2?: { variableExtractions?: VariableExtraction[] } | null
}>): SessionVar[] {
  const vars: SessionVar[] = []
  for (const node of nodes) {
    if (node.nodeType === 'NODE1' && node.node1?.variableExtractions) {
      vars.push(...node.node1.variableExtractions.map((v) => ({ ...v, fromNode: 'NODE1' as const })))
    }
    if (node.nodeType === 'NODE2' && node.node2?.variableExtractions) {
      vars.push(...node.node2.variableExtractions.map((v) => ({ ...v, fromNode: 'NODE2' as const })))
    }
  }
  return vars
}
