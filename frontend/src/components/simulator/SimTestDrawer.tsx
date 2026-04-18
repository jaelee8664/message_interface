import { useEffect, useRef, useState } from 'react'
import { authFetch } from '../../utils/authFetch'
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
  /** WEBSOCKET_SERVER / TCP_SERVER 전용: 현재 유닛으로 돌려보내기 여부 */
  replyToSelf?: boolean
  /** WEBSOCKET_SERVER / TCP_SERVER 전용: 현재 설정된 대상 클라이언트 IP */
  currentTargetIp?: string
}

interface Node0Info {
  protocol: string
}

interface Props {
  unitId: string
  node4Nodes: Node4NodeInfo[]
  node0Info?: Node0Info
  onResult: (result: UnitSimulationResult | null) => void
  onClose: () => void
  onHeightChange?: (height: number) => void
}

const MIN_HEIGHT = 150
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 210

function supportsHostPortOverride(protocol: string | null | undefined): boolean {
  if (!protocol) return false
  return protocol === 'REST_CLIENT' || protocol === 'WEBSOCKET_CLIENT' || protocol === 'TCP_CLIENT'
}

function supportsTargetIpOverride(n: Node4NodeInfo): boolean {
  return (n.protocol === 'WEBSOCKET_SERVER' || n.protocol === 'TCP_SERVER') && n.replyToSelf === false
}

export default function SimTestDrawer({ unitId, node4Nodes, node0Info, onResult, onClose, onHeightChange }: Props) {
  const [message, setMessage] = useState('{}')
  const [format, setFormat] = useState('JSON')
  const [node4Overrides, setNode4Overrides] = useState<Record<string, { host: string; port: string; ip: string }>>({})
  const [running, setRunning] = useState(false)

  const hostPortOverrideNodes = node4Nodes.filter(n => supportsHostPortOverride(n?.protocol))
  const targetIpOverrideNodes = node4Nodes.filter(n => supportsTargetIpOverride(n))

  // unitId가 바뀌면 저장된 테스트 메세지 불러오기
  useEffect(() => {
    if (!unitId) return
    authFetch(`/synapse/simulator/unit-message/${unitId}`)
      .then(r => {
        if (!r.ok) {
          setMessage('{}')
          setFormat('JSON')
          setNode4Overrides({})
          return null
        }
        return r.json()
      })
      .then(json => {
        if (!json?.data) return
        const saved = json.data
        setMessage(saved.message ?? '{}')
        setFormat(saved.format ?? 'JSON')
        const overrides: Record<string, { host: string; port: string; ip: string }> = {}
        for (const [nodeId, ov] of Object.entries(
          (saved.node4Overrides ?? {}) as Record<string, { host?: string; port?: number; targetIp?: string }>
        )) {
          overrides[nodeId] = {
            host: ov.host ?? '',
            port: ov.port != null ? String(ov.port) : '',
            ip: ov.targetIp ?? '',
          }
        }
        setNode4Overrides(overrides)
      })
      .catch(() => {
        setMessage('{}')
        setFormat('JSON')
        setNode4Overrides({})
      })
  }, [unitId])

  // Vertical resize (top edge)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  useEffect(() => { onHeightChange?.(DEFAULT_HEIGHT) }, [])  // notify initial height
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
        const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, vStartHeightRef.current + delta))
        setHeight(newH)
        onHeightChange?.(newH)
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

  function setOverride(nodeId: string, field: 'host' | 'port' | 'ip', value: string) {
    setNode4Overrides(prev => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] ?? { host: '', port: '', ip: '' }), [field]: value },
    }))
  }

  const isMongoQueue = node0Info?.protocol === 'MONGO_QUEUE_CONSUMER'

  /** MONGO_QUEUE_CONSUMER 전용: 큐에 발행 + 디큐 + 파이프라인을 백엔드에서 한 번에 처리 */
  async function runMongoQueue() {
    setRunning(true)
    onResult(null)
    try {
      const res = await authFetch('/synapse/simulator/enqueue-and-consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId, payload: message }),
      })
      const json = await res.json()
      onResult(json.data)
    } catch (e) {
      onResult({ success: false, nodeTraces: [], response: null, httpStatus: 0, errorMessage: String(e), durationMs: 0 })
    } finally {
      setRunning(false)
    }
  }

  async function run() {
    setRunning(true)
    onResult(null)
    try {
      const overridesPayload = Object.fromEntries(
        Object.entries(node4Overrides)
          .filter(([_, v]) => v.host.trim() || v.port.trim() || v.ip.trim())
          .map(([nodeId, v]) => [
            nodeId,
            {
              host: v.host.trim() || undefined,
              port: v.port.trim() ? parseInt(v.port) : undefined,
              targetIp: v.ip.trim() || undefined,
            },
          ])
      )

      const res = await authFetch('/synapse/simulator/execute', {
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
        {isMongoQueue ? (
          <span className="text-xs text-amber-400">— MONGO_QUEUE_CONSUMER: NODE1 직접 진입 또는 실제 큐 발행→컨슘</span>
        ) : (
          <span className="text-xs text-slate-500">— 선택 유닛으로 직접 진입 (조건 분기 미검사)</span>
        )}
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
                  const ov = node4Overrides[n.nodeId] ?? { host: '', port: '', ip: '' }
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

          {/* NODE4 target client IP overrides — WEBSOCKET_SERVER / TCP_SERVER with replyToSelf=false */}
          {targetIpOverrideNodes.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">대상 클라이언트 IP 오버라이드</label>
              <p className="text-[10px] text-slate-500 mb-1">비워두면 워크플로우에 설정된 IP로 전송됩니다.</p>
              <div className="space-y-1">
                {targetIpOverrideNodes.map(n => {
                  const ov = node4Overrides[n.nodeId] ?? { host: '', port: '', ip: '' }
                  return (
                    <div key={n.nodeId}>
                      <div className="text-xs text-slate-500 truncate mb-0.5" title={n.label}>
                        {n.label}
                      </div>
                      <input
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                        placeholder={n.currentTargetIp ?? '예: 192.168.0.10'}
                        value={ov.ip}
                        onChange={e => setOverride(n.nodeId, 'ip', e.target.value)}
                      />
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

        {/* Right: run button(s) */}
        <div className="flex flex-col justify-end gap-2 shrink-0">
          {isMongoQueue && (
            <div className="flex flex-col items-end gap-0.5">
              <button
                className="px-3 py-2 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                onClick={runMongoQueue}
                disabled={running || !unitId}
              >
                {running ? '실행 중...' : '큐 발행→컨슘'}
              </button>
              <span className="text-[10px] text-amber-500/80 whitespace-nowrap">
                메세지 → MongoDB → NODE0 → NODE1… (실제 흐름, 노드별 결과 확인 가능)
              </span>
            </div>
          )}
          <div className="flex flex-col items-end gap-0.5">
            <button
              className="px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              onClick={run}
              disabled={running || !unitId}
            >
              {running ? '실행 중...' : '▶ 실행'}
            </button>
            <span className="text-[10px] text-slate-300 whitespace-nowrap">
              {isMongoQueue ? '메세지 → NODE1… (NODE0 건너뜀, 노드별 결과 확인 가능)' : '메세지 → NODE1… (조건 분기 미검사)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
