import { useRef, useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { WorkflowUnit } from '../types/workflow'
import { generateId } from '../utils/generateId'

interface Props {
  onClose: () => void
}

export default function ImportUnitModal({ onClose }: Props) {
  const { units, saveUnit } = useWorkflowStore()

  const [parsed, setParsed] = useState<Omit<WorkflowUnit, 'id'> | null>(null)
  const [unitName, setUnitName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [modifiedBy, setModifiedBy] = useState('')
  const [password, setPassword] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const nameCollision = !!parsed && units.some(u => u.name === unitName)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string)
        if (!raw.name || !raw.condition || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
          setParseError('올바른 워크플로우 단위 JSON 파일이 아닙니다.')
          setParsed(null)
          return
        }
        const { id: _id, ...rest } = raw
        setParsed(rest)
        setUnitName(rest.name)
        setParseError(null)
        setSaveError(null)
      } catch {
        setParseError('JSON 파싱에 실패했습니다.')
        setParsed(null)
      }
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (!parsed || !modifiedBy || !password) return
    setSaving(true)
    setSaveError(null)
    try {
      const unit: WorkflowUnit = {
        ...parsed,
        id: generateId('unit'),
        name: unitName,
      }
      await saveUnit(unit, modifiedBy, password)
      onClose()
    } catch (e: any) {
      setSaveError(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-96 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto p-5 space-y-4">
          <div className="text-base font-semibold text-white">워크플로우 단위 가져오기</div>

          {/* File picker */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-dashed border-slate-500 hover:border-slate-400 transition-colors"
            >
              {parsed ? '✓ 파일 선택됨 — 다시 선택하려면 클릭' : 'JSON 파일 선택...'}
            </button>
            {parseError && <div className="text-xs text-red-400 mt-1">{parseError}</div>}
          </div>

          {/* Name field */}
          {parsed && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">단위 이름</label>
                <input
                  type="text"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                {nameCollision && (
                  <div className="text-xs text-amber-400 mt-1">
                    ⚠️ 같은 이름의 단위가 이미 존재합니다. 다른 이름을 사용하거나 덮어쓰게 됩니다.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">수정자 이름</label>
                <input
                  type="text"
                  value={modifiedBy}
                  onChange={(e) => setModifiedBy(e.target.value)}
                  placeholder="수정자 이름"
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {saveError && <div className="text-xs text-red-400">{saveError}</div>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
            >
              취소
            </button>
            <button
              onClick={handleImport}
              disabled={!parsed || !modifiedBy || !password || !unitName || saving}
              className={`flex-1 py-2 text-sm rounded font-medium transition-colors ${
                parsed && modifiedBy && password && unitName && !saving
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              {saving ? '저장 중...' : '가져오기'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
