import { useState } from 'react'
import type { SimulationNodeTrace } from './PipelineTraceView'

export interface UnitSimulationResult {
  success: boolean
  nodeTraces: SimulationNodeTrace[]
  response: string | null
  httpStatus: number
  errorMessage: string | null
  durationMs: number
}

export interface Node4NodeInfo {
  nodeId: string
  label: string        // e.g. "REST_CLIENT → 192.168.0.10:8080"
  currentHost?: string
  currentPort?: number
}

const PROTOCOLS = [
  'REST_SERVER', 'REST_CLIENT',
  'WEBSOCKET_SERVER', 'WEBSOCKET_CLIENT',
  'TCP_SERVER', 'TCP_CLIENT',
  'KAFKA_CONSUMER', 'KAFKA_PUBLISHER',
]

interface Props {
  unitId: string
  node4Nodes: Node4NodeInfo[]
  onResult: (result: UnitSimulationResult | null) => void
  onClose: () => void
}

export default function SimTestDrawer({ unitId, node4Nodes, onResult, onClose }: Props) {
  const [message, setMessage] = useState('{}')
  const [format, setFormat] = useState('JSON')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [protocol, setProtocol] = useState('REST_SERVER')
  const [endpoint, setEndpoint] = useState('')
  // nodeId → { host, port } — only for nodes where user typed something
  const [node4Overrides, setNode4Overrides] = useState<Record<string, { host: string; port: string }>>({})
  const [running, setRunning] = useState(false)

  function setOverride(nodeId: string, field: 'host' | 'port', value: string) {
    setNode4Overrides(prev => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] ?? { host: '', port: '' }), [field]: value },
    }))
  }

  async function run() {
    setRunning(true)
    onResult(null)
    try {
      // Build node4Overrides payload — skip entries where both host and port are empty
      const overridesPayload = Object.fromEntries(
        Object.entries(node4Overrides)
          .filter(([_, v]) => v.host.trim() || v.port.trim())
          .map(([nodeId, v]) => [
            nodeId,
            {
              host: v.host.trim() || undefined,
              port: v.port.trim() ? parseInt(v.port) : undefined,
            },
          ])
      )

      const res = await fetch('/synapse/simulator/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          message,
          format,
          endpoint: endpoint || undefined,
          protocol,
          node4Overrides: overridesPayload,
        }),
      })
      const json = await res.json()
      onResult(json.data)
    } catch (e) {
      onResult({
        success: false,
        nodeTraces: [],
        response: null,
        httpStatus: 0,
        errorMessage: String(e),
        durationMs: 0,
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border-t border-slate-700 bg-slate-900 shrink-0 flex flex-col" style={{ height: 196 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-700 shrink-0">
        <span className="text-xs font-semibold text-green-400">▶ 테스트 모드</span>
        <span className="text-xs text-slate-500">— 선택 유닛으로 직접 진입 (조건 분기 미검사)</span>
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-xs px-1">✕</button>
      </div>

      <div className="flex gap-3 px-4 py-2.5 flex-1 overflow-hidden min-h-0">
        {/* Left: controls */}
        <div className="flex flex-col gap-2 shrink-0 w-60 overflow-y-auto">
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">포맷</label>
              <select
                className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                value={format}
                onChange={e => setFormat(e.target.value)}
              >
                <option>JSON</option>
                <option>XML</option>
              </select>
            </div>
            <button
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
              onClick={() => setShowAdvanced(v => !v)}
            >
              고급 {showAdvanced ? '▲' : '▼'}
            </button>
          </div>

          {showAdvanced && (
            <div className="flex flex-col gap-1.5">
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">프로토콜</label>
                <select
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                  value={protocol}
                  onChange={e => setProtocol(e.target.value)}
                >
                  {PROTOCOLS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">엔드포인트</label>
                <input
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                  placeholder="/api/example"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>

              {/* Per-NODE4 overrides */}
              {node4Nodes.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">NODE4 오버라이드</label>
                  <div className="space-y-1">
                    {node4Nodes.map(n => {
                      const ov = node4Overrides[n.nodeId] ?? { host: '', port: '' }
                      return (
                        <div key={n.nodeId}>
                          <div className="text-xs text-slate-500 truncate mb-0.5" title={n.label}>
                            {n.label}
                          </div>
                          <div className="flex gap-1">
                            <input
                              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                              placeholder={n.currentHost ?? 'host'}
                              value={ov.host}
                              onChange={e => setOverride(n.nodeId, 'host', e.target.value)}
                            />
                            <input
                              className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                              placeholder={n.currentPort != null ? String(n.currentPort) : 'port'}
                              type="number"
                              value={ov.port}
                              onChange={e => setOverride(n.nodeId, 'port', e.target.value)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Center: message */}
        <div className="flex-1 flex flex-col gap-1 min-h-0">
          <label className="text-xs text-slate-400 shrink-0">메시지</label>
          <textarea
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white font-mono resize-none min-h-0"
            value={message}
            onChange={e => setMessage(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Right: run button */}
        <div className="flex flex-col justify-end shrink-0">
          <button
            className="px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            onClick={run}
            disabled={running || !unitId}
          >
            {running ? '실행 중...' : '▶ 실행'}
          </button>
        </div>
      </div>
    </div>
  )
}
