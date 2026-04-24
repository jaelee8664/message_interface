import { useState } from 'react'
import { MessageFormat, NodeErrorField, NodeErrorFieldSource, NodeErrorResponse } from '../../types/workflow'
import { SessionVar, SessionVarSelect } from '../ui/SessionVarPicker'
import { buildNestedPreview, parseSampleToFields, SAMPLE_PLACEHOLDERS } from '../../utils/node5Preview'

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


function SampleImportSection({
  messageFormat,
  hasExistingFields,
  onApply,
}: {
  messageFormat: MessageFormat
  hasExistingFields: boolean
  onApply: (fields: NodeErrorField[], mode: 'replace' | 'append') => void
}) {
  const [open, setOpen] = useState(false)
  const [sampleText, setSampleText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  const handleParse = (mode: 'replace' | 'append') => {
    try {
      setParseError(null)
      const fields = parseSampleToFields(sampleText.trim(), messageFormat)
      onApply(fields, mode)
      setSampleText('')
      setOpen(false)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : '파싱 오류가 발생했습니다.')
    }
  }

  return (
    <div className="rounded border border-dashed border-slate-600 bg-slate-800/30">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 rounded"
      >
        <span className="font-medium">샘플에서 자동 생성</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-2">
          <div className="text-xs text-slate-500">
            {messageFormat} 응답 샘플을 붙여넣으면 모든 리프 필드를 <span className="text-cyan-400">FROM_MAP</span>으로 자동 등록합니다.
          </div>
          <textarea
            value={sampleText}
            onChange={e => { setSampleText(e.target.value); setParseError(null) }}
            placeholder={SAMPLE_PLACEHOLDERS[messageFormat as 'JSON' | 'XML'] ?? ''}
            className="w-full h-36 px-2 py-1.5 text-xs font-mono rounded bg-slate-900 border border-slate-600 text-slate-300 resize-y focus:outline-none focus:border-blue-500"
          />
          {parseError && <div className="text-xs text-red-400">{parseError}</div>}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleParse(hasExistingFields ? 'append' : 'replace')}
              disabled={!sampleText.trim()}
              className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40"
            >
              {hasExistingFields ? '+ 추가' : '자동 생성'}
            </button>
            {hasExistingFields && (
              <button
                onClick={() => handleParse('replace')}
                disabled={!sampleText.trim()}
                className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40"
              >
                교체
              </button>
            )}
          </div>
          {hasExistingFields && (
            <div className="text-xs text-slate-500">
              <span className="text-emerald-400">+ 추가</span>: 기존 필드에 병합 &nbsp;|&nbsp;
              <span className="text-amber-400">교체</span>: 기존 필드 전체 교체
            </div>
          )}
        </div>
      )}
    </div>
  )
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

  const handleSampleImport = (fields: NodeErrorField[], mode: 'replace' | 'append') => {
    if (mode === 'replace') {
      update({ fields })
    } else {
      const existingKeys = new Set(value.fields.map(f => f.key))
      const newFields = fields.filter(f => !existingKeys.has(f.key))
      update({ fields: [...value.fields, ...newFields] })
    }
  }

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

        <SampleImportSection
          messageFormat={value.messageFormat}
          hasExistingFields={value.fields.length > 0}
          onApply={handleSampleImport}
        />

        {value.fields.length === 0 && (
          <p className="text-xs text-slate-500">필드를 추가하거나 샘플에서 자동 생성하세요.</p>
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
                placeholder={field.source === 'LITERAL' ? '고정 문자열 값' : 'currentMap 키 (예: header.msgName)'}
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
              {buildNestedPreview(value.fields, '(필드 없음)')}
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
