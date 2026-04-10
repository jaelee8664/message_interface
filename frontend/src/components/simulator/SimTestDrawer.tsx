import { useEffect, useRef, useState } from 'react'
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
  protocol: string
  currentHost?: string
  currentPort?: number
}

interface Props {
  unitId: string
  node4Nodes: Node4NodeInfo[]
  onResult: (result: UnitSimulationResult | null) => void
  onClose: () => void
}

const MIN_HEIGHT = 150
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 210

function supportsHostPortOverride(protocol: string | null | undefined): boolean {
  if (!protocol) return false
  return protocol === 'REST_CLIENT' || protocol === 'WEBSOCKET_CLIENT' || protocol === 'TCP_CLIENT'
}

export default function SimTestDrawer({ unitId, node4Nodes, onResult, onClose }: Props) {
  const [message, setMessage] = useState('{}')
  const [format, setFormat] = useState('JSON')
  const [node4Overrides, setNode4Overrides] = useState<Record<string, { host: string; port: string }>>({})
  const [running, setRunning] = useState(false)

  const hostPortOverrideNodes = node4Nodes.filter(n => supportsHostPortOverride(n?.protocol))

  // Vertical resize (top edge)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const vDraggingRef = useRef(false)
  const vStartYRef = useRef(0)
  const vStartHeightRef = useRef(0)

  function onVDragStart(e: React.MouseEvent) {
    e.preventDefault()
    vDraggingRef.current = true
    vStartYRef.current = e.clientY
    vStartHeightRef.current = height
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  // Horizontal resize (between left controls and message)
  const [leftWidth, setLeftWidth] = useState(208)
  const hDraggingRef = useRef(false)
  const hStartXRef = useRef(0)
  const hStartWidthRef = useRef(0)

  function onHDragStart(e: React.MouseEvent) {
    e.preventDefault()
    hDraggingRef.current = true
    hStartXRef.current = e.clientX
    hStartWidthRef.current = leftWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (vDraggingRef.current) {
        const delta = vStartYRef.current - e.clientY
        setHeight(h => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, vStartHeightRef.current + delta)))
      }
      if (hDraggingRef.current) {
        const delta = e.clientX - hStartXRef.current
        setLeftWidth(w => Math.min(480, Math.max(120, hStartWidthRef.current + delta)))
      }
    }
    const onUp = () => {
      if (vDraggingRef.current) {
        vDraggingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      if (hDraggingRef.current) {
        hDraggingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

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
    <div className="border-t border-slate-700 bg-slate-900 shrink-0 flex flex-col" style={{ height }}>
      {/* Vertical resize handle (top edge) */}
      <div
        className="h-1.5 cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors shrink-0"
        onMouseDown={onVDragStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-700 shrink-0">
        <span className="text-xs font-semibold text-green-400">▶ 테스트 모드</span>
        <span className="text-xs text-slate-500">— 선택 유닛으로 직접 진입 (조건 분기 미검사)</span>
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-xs px-1">✕</button>
      </div>

      <div className="flex px-4 py-2.5 flex-1 overflow-hidden min-h-0 gap-0">
        {/* Left: controls */}
        <div className="flex flex-col gap-2 shrink-0 overflow-y-auto" style={{ width: leftWidth }}>
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

          {/* NODE4 host/port overrides — only protocols with a target address */}
          {hostPortOverrideNodes.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">NODE4 오버라이드</label>
              <p className="text-[10px] text-slate-500 mb-1">비워두면 워크플로우에 설정된 주소로 전송됩니다.</p>
              <div className="space-y-1">
                {hostPortOverrideNodes.map(n => {
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

        {/* Horizontal resize handle */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors mx-1.5 rounded"
          onMouseDown={onHDragStart}
        />

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
