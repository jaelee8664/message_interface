import { useState } from 'react'
import {
  Node5Definition,
  Node5SuccessConfig,
  MessageFormat,
  NodeErrorField,
  NodeErrorFieldSource,
  NodeErrorResponse,
} from '../../types/workflow'
import { NodeErrorResponseEditor } from './NodeErrorResponseSection'

interface Props {
  definition: Node5Definition | undefined
  onChange: (def: Node5Definition) => void
}

const DEFAULT_SUCCESS_CONFIG: Node5SuccessConfig = {
  httpStatus: 200,
  messageFormat: 'JSON',
  fields: [],
  passCurrentMap: false,
}

const DEFAULT_ERROR_CONFIG: NodeErrorResponse = {
  messageFormat: 'JSON',
  fields: [],
}

const DEFAULT_DEF: Node5Definition = {
  responseType: 'HTTP_RESPONSE',
  successConfig: DEFAULT_SUCCESS_CONFIG,
  defaultErrorConfig: DEFAULT_ERROR_CONFIG,
}

const FORMAT_OPTIONS: { value: MessageFormat; label: string }[] = [
  { value: 'JSON', label: 'JSON' },
  { value: 'XML', label: 'XML' },
]

const COMMON_HTTP_STATUS: { value: number; label: string }[] = [
  { value: 200, label: '200 OK' },
  { value: 201, label: '201 Created' },
  { value: 204, label: '204 No Content' },
  { value: 400, label: '400 Bad Request' },
  { value: 401, label: '401 Unauthorized' },
  { value: 403, label: '403 Forbidden' },
  { value: 404, label: '404 Not Found' },
  { value: 422, label: '422 Unprocessable Entity' },
  { value: 500, label: '500 Internal Server Error' },
  { value: 503, label: '503 Service Unavailable' },
]

// EXCEPTION_MESSAGE is only meaningful for error responses; exclude from success UI
const SUCCESS_SOURCE_OPTIONS: { value: NodeErrorFieldSource; label: string }[] = [
  { value: 'LITERAL', label: '리터럴' },
  { value: 'FROM_MAP', label: '맵에서' },
]

// ── Success field preview ─────────────────────────────────────────────────────

function buildSuccessPreviewJson(fields: NodeErrorField[]): string {
  if (fields.length === 0) return '(빈 body — 필드를 추가하면 body가 생성됩니다)'
  const lines: string[] = []
  fields.forEach((f, i) => {
    if (!f.key) return
    const comma = i < fields.length - 1 ? ',' : ''
    const valueStr =
      f.source === 'LITERAL'
        ? `"${f.value}"`
        : `"(currentMap["${f.value}"])"`
    lines.push(`  "${f.key}": ${valueStr}${comma}`)
  })
  return lines.length === 0 ? '(빈 body)' : `{\n${lines.join('\n')}\n}`
}

function SuccessFieldPreview({ fields }: { fields: NodeErrorField[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded border border-slate-700">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium">응답 body 구조 미리보기</span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-700 px-3 py-2 bg-slate-900/50">
          <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {buildSuccessPreviewJson(fields)}
          </pre>
          {fields.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              * FROM_MAP 값은 NODE5 도달 시점의 currentMap에서 가져옵니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Success config editor ─────────────────────────────────────────────────────

function SuccessConfigEditor({
  config,
  onChange,
}: {
  config: Node5SuccessConfig
  onChange: (c: Node5SuccessConfig) => void
}) {
  const update = (partial: Partial<Node5SuccessConfig>) => onChange({ ...config, ...partial })

  const addField = () =>
    update({ fields: [...config.fields, { key: '', source: 'LITERAL', value: '' }] })

  const updateField = (idx: number, partial: Partial<NodeErrorField>) => {
    const next = config.fields.map((f, i) => (i === idx ? { ...f, ...partial } : f))
    update({ fields: next })
  }

  const removeField = (idx: number) =>
    update({ fields: config.fields.filter((_, i) => i !== idx) })

  const isCustomStatus = !COMMON_HTTP_STATUS.some((s) => s.value === config.httpStatus)

  return (
    <div className="space-y-3">
      {/* HTTP Status */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-300">HTTP 상태 코드</label>
        <div className="flex gap-2">
          <select
            className="flex-1 px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
            value={isCustomStatus ? 'custom' : config.httpStatus}
            onChange={(e) => {
              if (e.target.value !== 'custom') update({ httpStatus: Number(e.target.value) })
            }}
          >
            {COMMON_HTTP_STATUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
            <option value="custom">직접 입력…</option>
          </select>
          {isCustomStatus && (
            <input
              type="number"
              className="w-24 px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
              value={config.httpStatus}
              onChange={(e) => update({ httpStatus: Number(e.target.value) })}
              min={100}
              max={599}
            />
          )}
        </div>
      </div>

      {/* Format */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-300">직렬화 형식</label>
        <select
          className="w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          value={config.messageFormat}
          onChange={(e) => update({ messageFormat: e.target.value as MessageFormat })}
        >
          {FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* XML Root Element — only shown when XML format selected */}
      {config.messageFormat === 'XML' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">XML 루트 엘리먼트</label>
          <input
            type="text"
            className="w-full px-3 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            value={config.xmlRootElement ?? ''}
            onChange={(e) => update({ xmlRootElement: e.target.value || undefined })}
            placeholder="예: Message"
          />
          <p className="text-xs text-slate-500">XML 응답의 최상위 태그 이름. 비우면 루트 태그 없이 직렬화됩니다.</p>
        </div>
      )}

      {/* passCurrentMap toggle */}
      <div className="flex items-center gap-2 py-1">
        <input
          id="passCurrentMap"
          type="checkbox"
          className="w-3.5 h-3.5 accent-cyan-500 cursor-pointer"
          checked={config.passCurrentMap ?? false}
          onChange={(e) => update({ passCurrentMap: e.target.checked })}
        />
        <label htmlFor="passCurrentMap" className="text-xs text-slate-300 cursor-pointer select-none">
          currentMap 전체 전달
        </label>
      </div>
      {config.passCurrentMap ? (
        <div className="rounded-md bg-cyan-950/40 border border-cyan-800/40 px-3 py-2 text-xs text-cyan-400 leading-relaxed">
          파이프라인이 만들어 온 currentMap 전체를 직렬화하여 반환합니다. 아래 필드 설정은 무시됩니다.
        </div>
      ) : (
        <>
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

            {config.fields.length === 0 && (
              <p className="text-xs text-slate-500">
                필드를 추가하면 body가 생성됩니다. 없으면 빈 body가 전송됩니다.
              </p>
            )}

            {config.fields.map((field, idx) => (
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
                    {SUCCESS_SOURCE_OPTIONS.map((o) => (
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
                <input
                  type="text"
                  className="w-full px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  value={field.value}
                  onChange={(e) => updateField(idx, { value: e.target.value })}
                  placeholder={
                    field.source === 'LITERAL'
                      ? '고정 문자열 값'
                      : 'currentMap 키 (예: couponId)'
                  }
                />
              </div>
            ))}
          </div>

          {/* Preview */}
          <SuccessFieldPreview fields={config.fields} />
        </>
      )}
    </div>
  )
}

// ── Root panel ────────────────────────────────────────────────────────────────

export default function Node5Panel({ definition, onChange }: Props) {
  const def = definition ?? DEFAULT_DEF
  const [tab, setTab] = useState<'success' | 'error'>('success')

  const update = (partial: Partial<Node5Definition>) => onChange({ ...def, ...partial })

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-md bg-cyan-950/50 border border-cyan-800/50 px-3 py-2 text-xs text-cyan-300 leading-relaxed space-y-1.5">
        <p>NODE5는 REST 서버의 HTTP 응답(성공·오류)을 명시적으로 제어합니다.</p>
        <p className="text-cyan-500">NODE5가 없으면 성공 시 빈 body(200), 오류 시 예외 종류에 따른 HTTP 상태 코드가 자동 반환됩니다.</p>
        <div className="border-t border-cyan-800/40 pt-1.5 space-y-0.5">
          <p className="text-cyan-400 font-medium">NODE5 → 다음 노드 추가 실행 (선택)</p>
          <p className="text-cyan-500">
            NODE5에서 다른 노드(주로 NODE4)로 엣지를 연결하면, NODE5가 생성한 응답 body를 currentMap으로 전달하여 추가 작업을 실행할 수 있습니다.
          </p>
          <p className="text-cyan-500">
            성공·오류 두 경우 모두 동작합니다. 예: 오류 응답 생성 후 → 연결된 NODE4가 Kafka·WebSocket 등으로 알림 발송.
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded overflow-hidden border border-slate-700">
        <button
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            tab === 'success'
              ? 'bg-emerald-700 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
          onClick={() => setTab('success')}
        >
          ✓ 성공 응답
        </button>
        <button
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            tab === 'error'
              ? 'bg-red-700 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
          onClick={() => setTab('error')}
        >
          ✕ 기본 오류 응답
        </button>
      </div>

      {tab === 'success' ? (
        <SuccessConfigEditor
          config={def.successConfig}
          onChange={(c) => update({ successConfig: c })}
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-slate-400 leading-relaxed">
            오류가 발생한 노드에 직접 설정된 오류 응답이 없을 때 사용되는 기본값입니다.
            <br />
            <span className="text-slate-500">
              HTTP 상태 코드는 예외에서 자동으로 결정됩니다.
              (ResponseStatusException → 해당 코드 / 그 외 → 500)
            </span>
          </div>
          <NodeErrorResponseEditor
            value={def.defaultErrorConfig}
            onChange={(r) => update({ defaultErrorConfig: r })}
          />
        </div>
      )}
    </div>
  )
}
