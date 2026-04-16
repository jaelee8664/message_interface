import { useState } from 'react'
import type { SimulationNodeTrace } from './PipelineTraceView'

const NODE_COLORS: Record<string, string> = {
  NODE0: '#64748b',
  NODE1: '#8b5cf6',
  NODE2: '#f59e0b',
  NODE3: '#10b981',
  NODE4: '#ef4444',
  NODE5: '#06b6d4',
}

const NODE_LABELS: Record<string, string> = {
  NODE0: '수신',
  NODE1: '입력 DTO',
  NODE2: '변환',
  NODE3: '출력 DTO',
  NODE4: '송신',
  NODE5: '응답',
}

interface Props {
  traces: SimulationNodeTrace[]
  success: boolean
  durationMs: number
  errorMessage: string | null
  response: string | null
  activeNodeId: string | null
  onNodeClick: (nodeId: string) => void
  onClose: () => void
}

function SnapshotBlock({ label, data }: { label: string; data: Record<string, unknown> }) {
  return (
    <div>
      <div className="text-xs text-slate-400 font-medium mb-1">{label}</div>
      <pre className="text-xs bg-slate-950 rounded p-2 overflow-auto max-h-36 text-slate-300 whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

export default function SimTraceTimeline({
  traces,
  success,
  durationMs,
  errorMessage,
  response,
  activeNodeId,
  onNodeClick,
  onClose,
}: Props) {
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)

  function toggleExpand(nodeId: string) {
    setExpandedNodeId(prev => prev === nodeId ? null : nodeId)
    onNodeClick(nodeId)
  }

  return (
    <div className="w-72 shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0">
        <span className={`text-xs font-semibold ${success ? 'text-green-400' : 'text-red-400'}`}>
          {success ? '✅ 성공' : '❌ 실패'}
        </span>
        <span className="text-xs text-slate-500 flex-1">{durationMs}ms</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xs px-1">✕</button>
      </div>

      {/* Error summary */}
      {!success && errorMessage && (
        <div className="px-3 py-2 bg-red-900/20 border-b border-red-800/40 shrink-0">
          <div className="text-xs text-red-300 break-all">{errorMessage}</div>
        </div>
      )}

      {/* Trace list */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-2">
          {traces.map((trace, i) => {
            const color = NODE_COLORS[trace.nodeType] ?? '#64748b'
            const isActive = trace.nodeId === activeNodeId
            const isExpanded = trace.nodeId === expandedNodeId
            const isError = trace.status === 'ERROR'

            return (
              <div key={trace.nodeId}>
                <button
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-slate-700/80' : 'hover:bg-slate-800'
                  }`}
                  onClick={() => toggleExpand(trace.nodeId)}
                >
                  {/* Timeline dot + connector */}
                  <div className="flex flex-col items-center self-stretch shrink-0 w-4">
                    {i > 0 && <div className="w-px flex-1 bg-slate-600 mb-0.5" style={{ minHeight: 6 }} />}
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        background: isError ? '#ef4444' : trace.nodeType === 'NODE0' ? '#475569' : color,
                        boxShadow: isError ? '0 0 4px #ef444488' : undefined,
                      }}
                    />
                    {i < traces.length - 1 && <div className="w-px flex-1 bg-slate-600 mt-0.5" style={{ minHeight: 6 }} />}
                  </div>

                  <span className="text-xs font-mono font-semibold text-white w-12 shrink-0">{trace.nodeType}</span>
                  <span className="text-xs text-slate-400 flex-1">{NODE_LABELS[trace.nodeType] ?? ''}</span>
                  <span className={`text-xs shrink-0 ${isError ? 'text-red-400' : trace.nodeType === 'NODE0' ? 'text-slate-500' : 'text-slate-500'}`}>
                    {isError ? '✕' : trace.nodeType === 'NODE0' ? '건너뜀' : `${trace.durationMs}ms`}
                  </span>
                  <span className="text-slate-600 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {/* Expanded I/O */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 bg-slate-800/40 border-l-2 ml-5" style={{ borderColor: trace.nodeType === 'NODE0' ? '#475569' : color }}>
                    {trace.nodeType === 'NODE0' && (
                      <div className="text-xs text-slate-500 pt-2">
                        테스트 시 NODE0(수신)은 건너뜁니다 — 메시지가 직접 주입됩니다.
                      </div>
                    )}
                    {isError && trace.errorMessage && (
                      <div>
                        <div className="text-xs text-red-400 font-medium mb-1 pt-2">에러</div>
                        <pre className="text-xs bg-slate-950 rounded p-2 text-red-300 whitespace-pre-wrap break-all max-h-32 overflow-auto">
                          {trace.errorMessage}
                        </pre>
                      </div>
                    )}
                    {trace.inputSnapshot && Object.keys(trace.inputSnapshot).length > 0 && (
                      <div className="pt-2">
                        <SnapshotBlock label="Input" data={trace.inputSnapshot as Record<string, unknown>} />
                      </div>
                    )}
                    {trace.outputSnapshot && Object.keys(trace.outputSnapshot).length > 0 && (
                      <SnapshotBlock label="Output" data={trace.outputSnapshot as Record<string, unknown>} />
                    )}
                    {trace.rawResponse && (
                      <div>
                        <div className="text-xs text-slate-400 font-medium mb-1">응답 본문</div>
                        <pre className="text-xs bg-slate-950 rounded p-2 text-slate-300 whitespace-pre-wrap break-all max-h-24 overflow-auto">
                          {trace.rawResponse}
                        </pre>
                      </div>
                    )}
                    {!isError && !trace.inputSnapshot && !trace.outputSnapshot && !trace.rawResponse && (
                      <div className="text-xs text-slate-500 pt-2">상세 정보 없음</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Final response */}
        {response && (
          <div className="px-3 pt-2 pb-3 border-t border-slate-700">
            <div className="text-xs text-slate-400 font-medium mb-1">최종 응답</div>
            <pre className="text-xs bg-slate-950 rounded p-2 text-slate-300 whitespace-pre-wrap break-all max-h-36 overflow-auto">
              {response}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
