import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServerSession { clientIp: string; sessionCount: number; allActive: boolean }
interface ClientConnection { key: string; connected: boolean }
interface GrpcServerSession { key: string; streamCount: number }
interface UnitStat {
  unitId: string
  unitName: string
  successCount: number
  errorCount: number
  lastActivity: string | null
}
interface ConnectionStatus {
  tcpServer: ServerSession[]
  webSocketServer: ServerSession[]
  webSocketClient: ClientConnection[]
  tcpClient: ClientConnection[]
  grpcServer: GrpcServerSession[]
  grpcClient: ClientConnection[]
}
interface MonitorStatus {
  windowMinutes: number
  connections: ConnectionStatus
  pipelineStats: UnitStat[]
  totalSuccess: number
  totalError: number
  generatedAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function totalConnections(c: ConnectionStatus) {
  return c.tcpServer.filter(s => s.allActive).length
    + c.webSocketServer.filter(s => s.allActive).length
    + c.webSocketClient.filter(s => s.connected).length
    + c.tcpClient.filter(s => s.connected).length
    + c.grpcServer.reduce((sum, s) => sum + s.streamCount, 0)
    + c.grpcClient.filter(s => s.connected).length
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-white'}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

function ConnectionSection({ title, items, renderRow }: {
  title: string
  items: unknown[]
  renderRow: (item: any, i: number) => React.ReactNode
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <span className="text-sm font-semibold text-slate-200">{title}</span>
        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{items.length}</span>
      </div>
      {items.length === 0
        ? <p className="text-xs text-slate-500 px-4 py-3">연결 없음</p>
        : <ul className="divide-y divide-slate-700/60">
            {items.map((item, i) => renderRow(item, i))}
          </ul>
      }
    </div>
  )
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-green-400' : 'bg-red-400'}`} />
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [10, 30, 60, 360, 1440]
const AUTO_REFRESH_SEC = 10

export default function MonitoringPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [windowMinutes, setWindowMinutes] = useState(60)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC)
  const countdownRef = useRef(AUTO_REFRESH_SEC)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus(wm = windowMinutes) {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get('/synapse/monitor/status', { params: { windowMinutes: wm } })
      setStatus(res.data.data)
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  function resetTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    countdownRef.current = AUTO_REFRESH_SEC
    setCountdown(AUTO_REFRESH_SEC)
    timerRef.current = setInterval(() => {
      countdownRef.current -= 1
      setCountdown(countdownRef.current)
      if (countdownRef.current <= 0) {
        countdownRef.current = AUTO_REFRESH_SEC
        setCountdown(AUTO_REFRESH_SEC)
        fetchStatus()
      }
    }, 1000)
  }

  useEffect(() => {
    fetchStatus()
    resetTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function handleWindowChange(wm: number) {
    setWindowMinutes(wm)
    fetchStatus(wm)
    resetTimer()
  }

  function handleRefresh() {
    fetchStatus()
    resetTimer()
  }

  const conn = status?.connections

  return (
    <div className="h-full overflow-y-auto bg-slate-900 text-slate-100 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold">모니터링</h1>
        <div className="flex items-center gap-3">
          {/* Window selector */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>조회 범위:</span>
            {WINDOW_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => handleWindowChange(w)}
                className={`px-2 py-1 rounded ${windowMinutes === w
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {w < 60 ? `${w}분` : w === 1440 ? '24h' : `${w / 60}h`}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
          >
            {loading ? '로딩...' : `새로고침 (${countdown}s)`}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/40 border border-red-700 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      {status && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard
              label="활성 연결 (전체)"
              value={totalConnections(status.connections)}
              sub={`TCP서버 ${conn!.tcpServer.filter(s=>s.allActive).length} · WS서버 ${conn!.webSocketServer.filter(s=>s.allActive).length} · WS클라 ${conn!.webSocketClient.filter(s=>s.connected).length} · TCP클라 ${conn!.tcpClient.filter(s=>s.connected).length} · gRPC서버 ${conn!.grpcServer.reduce((s,g)=>s+g.streamCount,0)} · gRPC클라 ${conn!.grpcClient.filter(s=>s.connected).length}`}
            />
            <SummaryCard
              label={`성공 처리 (최근 ${windowMinutes < 60 ? windowMinutes + '분' : windowMinutes / 60 + 'h'})`}
              value={status.totalSuccess}
              accent="text-green-400"
            />
            <SummaryCard
              label={`에러 (최근 ${windowMinutes < 60 ? windowMinutes + '분' : windowMinutes / 60 + 'h'})`}
              value={status.totalError}
              accent={status.totalError > 0 ? 'text-red-400' : 'text-slate-400'}
            />
            <SummaryCard
              label="에러율"
              value={
                (status.totalSuccess + status.totalError) === 0
                  ? '-'
                  : ((status.totalError / (status.totalSuccess + status.totalError)) * 100).toFixed(1) + '%'
              }
              accent={status.totalError > 0 ? 'text-red-400' : 'text-slate-400'}
              sub={`갱신: ${formatTime(status.generatedAt)}`}
            />
          </div>

          {/* Connection details */}
          <h2 className="text-sm font-semibold text-slate-400 mb-3">연결 상태</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
                <span className="text-sm font-semibold text-slate-200">TCP 서버 세션</span>
                <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{conn!.tcpServer.length}</span>
              </div>
              {conn!.tcpServer.length === 0
                ? <p className="text-xs text-slate-500 px-4 py-3">연결 없음</p>
                : <ul className="divide-y divide-slate-700/60">
                    {conn!.tcpServer.map((s: ServerSession, i) => (
                      <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                        <StatusDot active={s.allActive} />
                        <span className="text-slate-300 font-mono">{s.clientIp}</span>
                        {s.sessionCount > 1 && (
                          <span className="text-slate-500 font-mono">×{s.sessionCount}</span>
                        )}
                        <span className={`ml-auto text-xs ${s.allActive ? 'text-green-400' : 'text-yellow-400'}`}>
                          {s.allActive ? 'CONNECTED' : 'PARTIAL'}
                        </span>
                      </li>
                    ))}
                  </ul>
              }
              <p className="text-xs text-slate-600 px-4 py-2 border-t border-slate-700/60">
                * 첫 메시지 수신 후 목록에 표시됩니다
              </p>
            </div>
            <ConnectionSection
              title="WebSocket 서버 세션"
              items={conn!.webSocketServer}
              renderRow={(s: ServerSession, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <StatusDot active={s.allActive} />
                  <span className="text-slate-300 font-mono">{s.clientIp}</span>
                  {s.sessionCount > 1 && (
                    <span className="text-slate-500 font-mono">×{s.sessionCount}</span>
                  )}
                  <span className={`ml-auto text-xs ${s.allActive ? 'text-green-400' : 'text-yellow-400'}`}>
                    {s.allActive ? 'CONNECTED' : 'PARTIAL'}
                  </span>
                </li>
              )}
            />
            <ConnectionSection
              title="WebSocket 클라이언트"
              items={conn!.webSocketClient}
              renderRow={(s: ClientConnection, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <StatusDot active={s.connected} />
                  <span className="text-slate-300 font-mono truncate">{s.key}</span>
                  <span className={`ml-auto text-xs ${s.connected ? 'text-green-400' : 'text-red-400'}`}>
                    {s.connected ? 'CONNECTED' : 'DISCONNECTED'}
                  </span>
                </li>
              )}
            />
            <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
                <span className="text-sm font-semibold text-slate-200">TCP 클라이언트</span>
                <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{conn!.tcpClient.length}</span>
              </div>
              {conn!.tcpClient.length === 0
                ? <p className="text-xs text-slate-500 px-4 py-3">연결 없음</p>
                : <ul className="divide-y divide-slate-700/60">
                    {conn!.tcpClient.map((s: ClientConnection, i) => (
                      <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                        <StatusDot active={s.connected} />
                        <span className="text-slate-300 font-mono truncate">{s.key}</span>
                        <span className={`ml-auto text-xs ${s.connected ? 'text-green-400' : 'text-red-400'}`}>
                          {s.connected ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </li>
                    ))}
                  </ul>
              }
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
                <span className="text-sm font-semibold text-slate-200">gRPC 서버 스트림</span>
                <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">
                  {conn!.grpcServer.reduce((s, g) => s + g.streamCount, 0)}
                </span>
              </div>
              {conn!.grpcServer.length === 0
                ? <p className="text-xs text-slate-500 px-4 py-3">연결 없음</p>
                : <ul className="divide-y divide-slate-700/60">
                    {conn!.grpcServer.map((s: GrpcServerSession, i) => (
                      <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                        <StatusDot active={s.streamCount > 0} />
                        <span className="text-slate-300 font-mono truncate">{s.key}</span>
                        <span className="ml-auto text-green-400 font-mono">
                          {s.streamCount} stream{s.streamCount !== 1 ? 's' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
              }
            </div>
            <ConnectionSection
              title="gRPC 클라이언트"
              items={conn!.grpcClient}
              renderRow={(s: ClientConnection, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <StatusDot active={s.connected} />
                  <span className="text-slate-300 font-mono truncate">{s.key}</span>
                  <span className={`ml-auto text-xs ${s.connected ? 'text-green-400' : 'text-amber-400'}`}>
                    {s.connected ? 'CONNECTED' : 'RECONNECTING'}
                  </span>
                </li>
              )}
            />
          </div>

          {/* Pipeline stats table */}
          <h2 className="text-sm font-semibold text-slate-400 mb-3">워크플로우 유닛별 처리량</h2>
          {status.pipelineStats.length === 0
            ? <p className="text-xs text-slate-500">해당 기간 내 처리 기록 없음</p>
            : (
              <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="text-left px-4 py-2 font-medium">유닛명</th>
                      <th className="text-right px-4 py-2 font-medium">성공</th>
                      <th className="text-right px-4 py-2 font-medium">에러</th>
                      <th className="text-right px-4 py-2 font-medium">에러율</th>
                      <th className="text-right px-4 py-2 font-medium">마지막 처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {status.pipelineStats.map(stat => {
                      const total = stat.successCount + stat.errorCount
                      const errorRate = total === 0 ? 0 : (stat.errorCount / total) * 100
                      return (
                        <tr key={stat.unitId} className="hover:bg-slate-700/40 transition-colors">
                          <td className="px-4 py-2 text-slate-200">{stat.unitName}</td>
                          <td className="px-4 py-2 text-right text-green-400 font-mono">{stat.successCount}</td>
                          <td className={`px-4 py-2 text-right font-mono ${stat.errorCount > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                            {stat.errorCount}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${errorRate > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                            {errorRate.toFixed(1)}%
                          </td>
                          <td className="px-4 py-2 text-right text-slate-400">
                            {stat.lastActivity ? formatTime(stat.lastActivity) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </>
      )}

      {!status && !loading && !error && (
        <p className="text-slate-500 text-sm">데이터 없음</p>
      )}
    </div>
  )
}
