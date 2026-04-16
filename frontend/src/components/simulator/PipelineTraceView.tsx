import { useState } from 'react'

export type TraceStatus = 'SUCCESS' | 'ERROR'

export interface SimulationNodeTrace {
  nodeId: string
  nodeType: string
  status: TraceStatus
  durationMs: number
  inputSnapshot: Record<string, unknown> | null
  outputSnapshot: Record<string, unknown> | null
  rawResponse: string | null
  errorMessage: string | null
}

interface Props {
  traces: SimulationNodeTrace[]
  success: boolean
  response: string | null
  errorMessage: string | null
  durationMs: number
}

const NODE_COLORS: Record<string, string> = {
  NODE0: 'bg-slate-600',
  NODE1: 'bg-blue-700',
  NODE2: 'bg-violet-700',
  NODE3: 'bg-cyan-700',
  NODE4: 'bg-orange-700',
  NODE5: 'bg-emerald-700',
}

const NODE_LABELS: Record<string, string> = {
  NODE0: '수신',
  NODE1: '입력 DTO',
  NODE2: '변환',
  NODE3: '출력 DTO',
  NODE4: '송신',
  NODE5: '응답',
}

function SnapshotView({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-xs bg-slate-900 rounded p-2 overflow-auto max-h-48 text-slate-300 whitespace-pre-wrap break-all">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function NodeTraceCard({ trace }: { trace: SimulationNodeTrace }) {
  const [open, setOpen] = useState(false)
  const isError = trace.status === 'ERROR'
  const baseColor = NODE_COLORS[trace.nodeType] ?? 'bg-slate-600'
  const borderColor = isError ? 'border-red-500' : 'border-transparent'

  return (
    <div className={`rounded-lg border-2 ${borderColor} overflow-hidden`}>
      <button
        className={`w-full flex items-center gap-3 px-3 py-2 text-left ${baseColor} hover:brightness-110 transition-all`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-white font-bold text-xs w-16 shrink-0">{trace.nodeType}</span>
        <span className="text-slate-200 text-xs flex-1">{NODE_LABELS[trace.nodeType] ?? trace.nodeType}</span>
        <span className={`text-xs font-medium shrink-0 ${isError ? 'text-red-300' : trace.nodeType === 'NODE0' ? 'text-slate-400' : 'text-green-300'}`}>
          {isError ? '❌ 에러' : trace.nodeType === 'NODE0' ? '⏭ 건너뜀' : '✅ 성공'}
        </span>
        {trace.nodeType !== 'NODE0' && (
          <span className="text-slate-400 text-xs shrink-0">{trace.durationMs}ms</span>
        )}
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-slate-800 px-3 py-2 space-y-2 text-sm">
          {trace.nodeType === 'NODE0' && (
            <div className="text-slate-500 text-xs">
              테스트 시 NODE0(수신)은 건너뜁니다 — 메시지가 직접 주입됩니다.
            </div>
          )}
          {isError && trace.errorMessage && (
            <div>
              <div className="text-red-400 font-medium text-xs mb-1">에러 메시지</div>
              <pre className="text-xs bg-slate-900 rounded p-2 text-red-300 whitespace-pre-wrap break-all">
                {trace.errorMessage}
              </pre>
            </div>
          )}
          {trace.inputSnapshot && Object.keys(trace.inputSnapshot).length > 0 && (
            <div>
              <div className="text-slate-400 font-medium text-xs mb-1">입력 (실행 전)</div>
              <SnapshotView data={trace.inputSnapshot} />
            </div>
          )}
          {trace.outputSnapshot && Object.keys(trace.outputSnapshot).length > 0 && (
            <div>
              <div className="text-slate-400 font-medium text-xs mb-1">출력 (실행 후)</div>
              <SnapshotView data={trace.outputSnapshot} />
            </div>
          )}
          {trace.rawResponse && (
            <div>
              <div className="text-slate-400 font-medium text-xs mb-1">응답 본문</div>
              <pre className="text-xs bg-slate-900 rounded p-2 text-slate-300 whitespace-pre-wrap break-all">
                {trace.rawResponse}
              </pre>
            </div>
          )}
          {!isError && !trace.inputSnapshot && !trace.outputSnapshot && !trace.rawResponse && (
            <div className="text-slate-500 text-xs">상세 정보 없음</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PipelineTraceView({ traces, success, response, errorMessage, durationMs }: Props) {
  if (traces.length === 0) {
    if (!success && errorMessage) {
      return (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300 whitespace-pre-wrap break-all">
          <span className="font-medium">❌ 실패: </span>{errorMessage}
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium ${
        success ? 'bg-green-900/40 border border-green-700 text-green-300'
                : 'bg-red-900/40 border border-red-700 text-red-300'
      }`}>
        <span>{success ? '✅ 파이프라인 성공' : '❌ 파이프라인 실패'}</span>
        <span className="text-xs opacity-70">총 {durationMs}ms</span>
        {!success && errorMessage && (
          <span className="text-xs opacity-80 ml-auto truncate max-w-xs">{errorMessage}</span>
        )}
      </div>

      {/* Node flow visualization */}
      <div className="flex items-center gap-1 flex-wrap">
        {traces.map((trace, i) => (
          <div key={trace.nodeId} className="flex items-center gap-1">
            <div className={`px-2 py-1 rounded text-xs font-bold ${
              trace.nodeType === 'NODE0'
                ? 'bg-slate-700 text-slate-400'
                : `${NODE_COLORS[trace.nodeType] ?? 'bg-slate-600'} text-white`
            } ${trace.status === 'ERROR' ? 'ring-2 ring-red-400' : ''}`}>
              {trace.nodeType}
            </div>
            {i < traces.length - 1 && (
              <span className="text-slate-600 text-xs">→</span>
            )}
          </div>
        ))}
      </div>

      {/* Per-node detail cards */}
      <div className="space-y-1">
        {traces.map(trace => (
          <NodeTraceCard key={trace.nodeId} trace={trace} />
        ))}
      </div>

      {/* Final response */}
      {response && (
        <div>
          <div className="text-slate-400 text-xs font-medium mb-1">최종 응답</div>
          <pre className="text-xs bg-slate-900 border border-slate-700 rounded p-3 text-slate-300 whitespace-pre-wrap break-all max-h-64 overflow-auto">
            {response}
          </pre>
        </div>
      )}
    </div>
  )
}
