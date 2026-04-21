import { useState } from 'react'
import { MessageFormat, NodeErrorField, NodeErrorFieldSource, NodeErrorResponse } from '../../types/workflow'
import { SessionVar, SessionVarSelect } from '../ui/SessionVarPicker'

const DEFAULT_ERROR_RESPONSE: NodeErrorResponse = {
  messageFormat: 'JSON',
  fields: [],
}

const FORMAT_OPTIONS: { value: MessageFormat; label: string }[] = [
  { value: 'JSON', label: 'JSON' },
  { value: 'XML', label: 'XML' },
]

const SOURCE_OPTIONS: { value: NodeErrorFieldSource; label: string }[] = [
  { value: 'LITERAL', label: '리터럴' },
  { value: 'FROM_MAP', label: '맵에서' },
  { value: 'FROM_SESSION_VAR', label: '세션 변수' },
  { value: 'EXCEPTION_MESSAGE', label: '예외 메세지' },
]

function buildPreviewLines(fields: NodeErrorField[]): string {
  if (fields.length === 0) return '(필드 없음)'
  const lines: string[] = []
  fields.forEach((f, i) => {
    if (!f.key) return
    const comma = i < fields.length - 1 ? ',' : ''
    const valueStr =
      f.source === 'LITERAL'
        ? `"${f.value}"`
        : f.source === 'FROM_MAP'
        ? `"(currentMap["${f.value}"])"`
        : f.source === 'FROM_SESSION_VAR'
        ? `"(sessionVars["${f.value}"])"`
        : '"(예외 메세지)"'
    lines.push(`  "${f.key}": ${valueStr}${comma}`)
  })
  return `{\n${lines.join('\n')}\n}`
}

/** Editor for NodeErrorResponse fields (always-visible; used inside Node5Panel). */
export function NodeErrorResponseEditor({
  value,
  onChange,
  sessionVars = [],
}: {
  value: NodeErrorResponse
  onChange: (r: NodeErrorResponse) => void
  sessionVars?: SessionVar[]
}) {
  const [previewOpen, setPreviewOpen] = useState(false)

  const update = (partial: Partial<NodeErrorResponse>) => onChange({ ...value, ...partial })

  const addField = () =>
    update({ fields: [...value.fields, { key: '', source: 'LITERAL', value: '' }] })

  const updateField = (idx: number, partial: Partial<NodeErrorField>) => {
    const next = value.fields.map((f, i) => (i === idx ? { ...f, ...partial } : f))
    update({ fields: next })
  }

  const removeField = (idx: number) =>
    update({ fields: value.fields.filter((_, i) => i !== idx) })

  return (
    <div className="space-y-3">
      {/* Format */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-300">직렬화 형식</label>
        <select
          className="w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          value={value.messageFormat}
          onChange={(e) => update({ messageFormat: e.target.value as MessageFormat })}
        >
          {FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* XML Root Element */}
      {value.messageFormat === 'XML' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">XML 루트 엘리먼트</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            value={value.xmlRootElement ?? ''}
            onChange={(e) => update({ xmlRootElement: e.target.value || undefined })}
            placeholder="예: errorResponse (없으면 기본 태그 사용)"
          />
        </div>
      )}

      {/* Fields */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">응답 필드</span>
          <button
            onClick={addField}
            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600"
          >
            + 추가
          </button>
        </div>

        {value.fields.length === 0 && (
          <p className="text-xs text-slate-500">오류 응답에 포함할 필드를 추가하세요. 없으면 빈 body가 반환됩니다.</p>
        )}

        {value.fields.map((field, idx) => (
          <div key={idx} className="space-y-1 p-2 rounded bg-slate-800/60 border border-slate-700">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                className="flex-1 px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                value={field.key}
                onChange={(e) => updateField(idx, { key: e.target.value })}
                placeholder="key"
              />
              <select
                className="px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
                value={field.source}
                onChange={(e) =>
                  updateField(idx, { source: e.target.value as NodeErrorFieldSource, value: '' })
                }
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => removeField(idx)}
                className="text-red-400 hover:text-red-300 text-xs px-1"
              >
                ✕
              </button>
            </div>
            {field.source === 'FROM_SESSION_VAR' ? (
              <SessionVarSelect
                sessionVars={sessionVars}
                value={field.value}
                onChange={(v) => updateField(idx, { value: v })}
              />
            ) : field.source !== 'EXCEPTION_MESSAGE' ? (
              <input
                type="text"
                className="w-full px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                value={field.value}
                onChange={(e) => updateField(idx, { value: e.target.value })}
                placeholder={field.source === 'LITERAL' ? '고정 문자열 값' : 'currentMap 키 (예: couponId)'}
              />
            ) : (
              <p className="text-xs text-slate-500 px-1">예외 메세지가 자동으로 주입됩니다.</p>
            )}
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="rounded border border-slate-700">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
          onClick={() => setPreviewOpen((v) => !v)}
        >
          <span className="font-medium">응답 body 구조 미리보기</span>
          <span className="text-slate-500">{previewOpen ? '▲' : '▼'}</span>
        </button>
        {previewOpen && (
          <div className="border-t border-slate-700 px-3 py-2 bg-slate-900/50">
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
              {buildPreviewLines(value.fields)}
            </pre>
            <p className="mt-1 text-xs text-slate-500">
              * FROM_MAP 값은 오류 발생 시점의 currentMap에서 가져옵니다. 키가 없으면 해당 필드는 null이 됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Toggle section shown in Node0~Node4 panels:
 * - "기본값 사용 (NODE5 기본 오류 응답)" — errorResponse = null
 * - "직접 설정" — shows NodeErrorResponseEditor
 */
export default function NodeErrorResponseSection({
  errorResponse,
  onChange,
  sessionVars = [],
}: {
  errorResponse: NodeErrorResponse | null | undefined
  onChange: (r: NodeErrorResponse | null) => void
  sessionVars?: SessionVar[]
}) {
  const isCustom = errorResponse != null

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/60 space-y-3">
      <div className="text-xs font-medium text-slate-300">오류 응답</div>

      {/* Mode toggle */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            className="accent-blue-500"
            checked={!isCustom}
            onChange={() => onChange(null)}
          />
          <span className="text-xs text-slate-300">기본값 사용 (NODE5 기본 오류 응답)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            className="accent-blue-500"
            checked={isCustom}
            onChange={() => onChange(DEFAULT_ERROR_RESPONSE)}
          />
          <span className="text-xs text-slate-300">직접 설정</span>
        </label>
      </div>

      {isCustom && (
        <NodeErrorResponseEditor
          value={errorResponse!}
          onChange={onChange}
          sessionVars={sessionVars}
        />
      )}

      {!isCustom && (
        <p className="text-xs text-slate-500">
          NODE5에서 정의한 기본 오류 응답을 사용합니다.
        </p>
      )}
    </div>
  )
}
