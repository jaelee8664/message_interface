import { useState } from 'react'
import axios from 'axios'

interface TraceLog {
  traceId: string
  workflowUnitId: string
  workflowUnitName: string
  nodeType: string
  timestamp: string
  protocol: string
  targetInfo?: string
  messageSnippet: Record<string, any>
  status: 'SUCCESS' | 'ERROR'
  errorMessage?: string
}

interface TraceEntry {
  traceId: string
  firstSeen: string
  workflowUnitName: string
  entries: TraceLog[]
}

interface TraceSearchResult {
  fieldKey: string
  fieldValue: string
  traces: TraceEntry[]
}

const PAGE_SIZE = 10

const NODE_LABEL: Record<string, { label: string; color: string }> = {
  NODE0: { label: '수신', color: 'bg-blue-600' },
  NODE4: { label: '송신', color: 'bg-purple-600' },
  NODE5: { label: '응답', color: 'bg-green-600' },
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function toLocalDateStr(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

function NodeBadge({ nodeType }: { nodeType: string }) {
  const info = NODE_LABEL[nodeType] ?? { label: nodeType, color: 'bg-slate-600' }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded text-white ${info.color}`}>
      {info.label}
    </span>
  )
}

function LogEntryRow({ log }: { log: TraceLog }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`border-l-2 pl-3 mb-2 ${log.status === 'ERROR' ? 'border-red-500' : 'border-slate-600'}`}>
      <button
        className="w-full text-left flex items-center gap-2 py-1 group"
        onClick={() => setOpen(v => !v)}
      >
        <NodeBadge nodeType={log.nodeType} />
        <span className="text-xs text-slate-400 font-mono">{formatTime(log.timestamp)}</span>
        {log.nodeType !== 'NODE5' && (
          <span className="text-xs text-slate-500">{log.protocol}</span>
        )}
        {log.targetInfo && (
          <span className="text-xs text-slate-400 font-mono">→ {log.targetInfo}</span>
        )}
        {log.status === 'ERROR' && (
          <span className="text-xs text-red-400 font-bold">ERROR</span>
        )}
        <span className="ml-auto text-slate-600 group-hover:text-slate-400 text-xs">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="mt-1 mb-2">
          {log.errorMessage && (
            <div className="text-xs text-red-400 mb-1">{log.errorMessage}</div>
          )}
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-x-auto">
            {JSON.stringify(log.messageSnippet, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function TraceCard({ trace }: { trace: TraceEntry }) {
  const [open, setOpen] = useState(true)
  const hasError = trace.entries.some(e => e.status === 'ERROR')

  return (
    <div className={`rounded-lg border mb-3 ${hasError ? 'border-red-800 bg-red-950/20' : 'border-slate-700 bg-slate-800'}`}>
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        onClick={() => setOpen(v => !v)}
      >
        {hasError
          ? <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-700 text-white">ERROR</span>
          : <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-600 text-white">OK</span>
        }
        <span className="text-sm font-medium text-white">{trace.workflowUnitName || '(이름 없음)'}</span>
        <span className="text-xs text-slate-400 font-mono">{formatTime(trace.firstSeen)}</span>
        <span className="ml-auto text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-slate-700 pt-3">
          <div className="text-xs text-slate-600 font-mono mb-3">traceId: {trace.traceId}</div>
          {trace.entries.map((log, i) => (
            <LogEntryRow key={i} log={log} />
          ))}
        </div>
      )}
    </div>
  )
}

function Pagination({ total, page, onChange }: { total: number; page: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  if (totalPages <= 1) return null

  // Show up to 10 page buttons; if more, show window around current page
  const maxButtons = 10
  let start = 1
  let end = totalPages
  if (totalPages > maxButtons) {
    start = Math.max(1, page - Math.floor(maxButtons / 2))
    end = start + maxButtons - 1
    if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxButtons + 1) }
  }

  const pages = []
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center gap-1 mt-4 flex-wrap">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30"
      >
        ‹
      </button>
      {start > 1 && (
        <>
          <button onClick={() => onChange(1)} className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600">1</button>
          {start > 2 && <span className="text-slate-500 text-xs px-1">…</span>}
        </>
      )}
      {pages.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2 py-1 text-xs rounded ${p === page ? 'bg-blue-600 text-white font-bold' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-slate-500 text-xs px-1">…</span>}
          <button onClick={() => onChange(totalPages)} className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600">{totalPages}</button>
        </>
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30"
      >
        ›
      </button>
      <span className="text-xs text-slate-500 ml-2">{total}건 / {totalPages}페이지</span>
    </div>
  )
}

export default function LogPage() {
  const [fieldKey, setFieldKey] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [fromFiles, setFromFiles] = useState(true)
  const [fromDate, setFromDate] = useState(toLocalDateStr(1))
  const [toDate, setToDate] = useState(toLocalDateStr(0))

  const MAX_DAYS = 2

  function handleFromDateChange(val: string) {
    setFromDate(val)
    const from = new Date(val)
    const to = new Date(toDate)
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays > MAX_DAYS) {
      const capped = new Date(from)
      capped.setDate(capped.getDate() + MAX_DAYS)
      setToDate(capped.toISOString().split('T')[0])
    }
  }

  function handleToDateChange(val: string) {
    setToDate(val)
    const from = new Date(fromDate)
    const to = new Date(val)
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays > MAX_DAYS) {
      const capped = new Date(to)
      capped.setDate(capped.getDate() - MAX_DAYS)
      setFromDate(capped.toISOString().split('T')[0])
    }
  }
  const [result, setResult] = useState<TraceSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const search = async () => {
    if (!fieldKey || !fieldValue) return
    setLoading(true)
    setError(null)
    setPage(1)
    try {
      const res = await axios.get('/synapse/logs/trace', {
        params: { fieldKey, fieldValue, fromFiles, fromDate, toDate }
      })
      setResult(res.data.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Newest first
  const traces = [...(result?.traces ?? [])].reverse()
  const totalPages = Math.ceil(traces.length / PAGE_SIZE)
  const pageTraces = traces.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="p-6 h-full overflow-auto">
      <h1 className="text-xl font-bold text-white mb-6">메세지 추적 로그</h1>

      {/* Search form */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">필드 키</label>
          <input
            value={fieldKey}
            onChange={e => setFieldKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="예: header.trace_id"
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">값</label>
          <input
            value={fieldValue}
            onChange={e => setFieldValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="예: idnum_1"
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">시작일</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => handleFromDateChange(e.target.value)}
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">종료일 (최대 2일)</label>
          <input
            type="date"
            value={toDate}
            onChange={e => handleToDateChange(e.target.value)}
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">파일 검색</label>
          <label className="flex items-center gap-2 h-9 cursor-pointer">
            <input
              type="checkbox"
              checked={fromFiles}
              onChange={e => setFromFiles(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-300">파일에서 검색</span>
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">&nbsp;</label>
          <button
            onClick={search}
            disabled={loading}
            className="px-5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm disabled:opacity-50"
          >
            {loading ? '검색 중...' : '검색'}
          </button>
        </div>
      </div>

      {error && <div className="text-red-400 mb-4 text-sm">{error}</div>}

      {/* Result header */}
      {result && (
        <div className="text-sm text-slate-400 mb-4">
          <span className="text-white font-mono">{result.fieldKey}</span>
          {' = '}
          <span className="text-blue-400 font-mono">"{result.fieldValue}"</span>
          {' — '}
          <span className="text-white">{traces.length}건</span>
          {traces.length > PAGE_SIZE && (
            <span className="text-slate-500 ml-2">
              (페이지 {page} / {totalPages})
            </span>
          )}
        </div>
      )}

      {/* Trace list */}
      {traces.length === 0 && !loading && result && (
        <div className="text-slate-500 text-center py-12">결과 없음</div>
      )}
      {pageTraces.map((trace, i) => (
        <TraceCard key={i} trace={trace} />
      ))}

      {/* Pagination */}
      <Pagination total={traces.length} page={page} onChange={setPage} />
    </div>
  )
}
