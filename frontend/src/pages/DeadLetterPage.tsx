import { useEffect, useState } from 'react'
import axios from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeadLetterEntry {
  id: string
  traceId: string
  workflowUnitId: string
  workflowUnitName: string
  protocol: string
  endpoint: string | null
  metadata: Record<string, string>
  rawBytesBase64: string
  failedNodeType: string | null
  errorMessage: string | null
  timestamp: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function decodeBase64(b64: string): string {
  try {
    return atob(b64)
  } catch {
    return b64
  }
}

// ── Row component ─────────────────────────────────────────────────────────────

function DeadLetterRow({ entry }: { entry: DeadLetterEntry }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden mb-2">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/40 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-red-400 text-xs font-bold shrink-0">FAIL</span>
        <span className="text-slate-200 text-sm font-medium shrink-0">{entry.workflowUnitName}</span>
        {entry.failedNodeType && (
          <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300 shrink-0">
            {entry.failedNodeType}
          </span>
        )}
        <span className="text-xs bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-blue-300 shrink-0">
          {entry.protocol}
        </span>
        <span className="text-xs text-slate-500 truncate flex-1">{entry.errorMessage ?? '-'}</span>
        <span className="text-xs text-slate-500 shrink-0">{formatTime(entry.timestamp)}</span>
        <span className="text-slate-500 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 px-4 py-3 space-y-3 bg-slate-800/50">
          {/* Meta info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Trace ID</span>
              <p className="font-mono text-slate-300 break-all">{entry.traceId}</p>
            </div>
            <div>
              <span className="text-slate-400">Dead Letter ID</span>
              <p className="font-mono text-slate-300 break-all">{entry.id}</p>
            </div>
            {entry.endpoint && (
              <div>
                <span className="text-slate-400">Endpoint</span>
                <p className="font-mono text-slate-300">{entry.endpoint}</p>
              </div>
            )}
            {Object.keys(entry.metadata).length > 0 && (
              <div>
                <span className="text-slate-400">Metadata</span>
                <p className="font-mono text-slate-300">
                  {Object.entries(entry.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Original message */}
          <div>
            <span className="text-xs text-slate-400">원본 메세지 (raw bytes)</span>
            <pre className="mt-1 text-xs font-mono bg-slate-900 border border-slate-700 rounded p-3 overflow-x-auto text-slate-300 whitespace-pre-wrap break-all max-h-48">
              {decodeBase64(entry.rawBytesBase64)}
            </pre>
          </div>

          {/* Error message */}
          {entry.errorMessage && (
            <div>
              <span className="text-xs text-slate-400">에러 메세지</span>
              <pre className="mt-1 text-xs font-mono bg-red-950/40 border border-red-800/50 rounded p-3 overflow-x-auto text-red-300 whitespace-pre-wrap break-all max-h-32">
                {entry.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const DAY_OPTIONS = [1, 7, 14, 30]

export default function DeadLetterPage() {
  const [entries, setEntries] = useState<DeadLetterEntry[]>([])
  const [days, setDays] = useState(7)
  const [fromFiles, setFromFiles] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchEntries(d = days, ff = fromFiles) {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get('/synapse/dead-letters', {
        params: { days: d, limit: 200, fromFiles: ff }
      })
      setEntries(res.data.data)
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchEntries() }, [])

  function handleDaysChange(d: number) {
    setDays(d)
    fetchEntries(d, fromFiles)
  }

  function handleFromFilesChange(ff: boolean) {
    setFromFiles(ff)
    fetchEntries(days, ff)
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-900 text-slate-100 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold">데드레터</h1>
          <p className="text-xs text-slate-400 mt-0.5">파이프라인 처리 실패 메세지 보관함</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Days selector */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span>조회 범위:</span>
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => handleDaysChange(d)}
                className={`px-2 py-1 rounded ${days === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {d === 1 ? '오늘' : `${d}일`}
              </button>
            ))}
          </div>
          {/* Source toggle */}
          <button
            onClick={() => handleFromFilesChange(!fromFiles)}
            className={`text-xs px-3 py-1 rounded border ${fromFiles
              ? 'border-blue-500 text-blue-400 bg-blue-950/40'
              : 'border-slate-600 text-slate-400 bg-slate-800'}`}
          >
            {fromFiles ? '파일 검색' : '메모리'}
          </button>
          {/* Refresh */}
          <button
            onClick={() => fetchEntries()}
            disabled={loading}
            className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
          >
            {loading ? '로딩...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-400">총 <span className="text-white font-semibold">{entries.length}</span>건</span>
        {entries.length > 0 && (
          <span className="text-xs text-slate-500">
            최근: {formatTime(entries[0].timestamp)}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/40 border border-red-700 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      {/* List */}
      {entries.length === 0 && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <span className="text-4xl mb-3">✓</span>
          <p className="text-sm">데드레터 없음 — 처리 실패한 메세지가 없습니다</p>
        </div>
      )}

      {entries.map(entry => (
        <DeadLetterRow key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
