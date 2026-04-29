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
  filterGroups: { key: string; value: string }[][]
  traces: TraceEntry[]
}

type FilterCondition = { key: string; value: string }
type FilterGroup = FilterCondition[]

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

function toLocalDateTimeStr(hoursAgo = 0) {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
        className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30">‹</button>
      {start > 1 && (
        <>
          <button onClick={() => onChange(1)} className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600">1</button>
          {start > 2 && <span className="text-slate-500 text-xs px-1">…</span>}
        </>
      )}
      {pages.map(p => (
        <button key={p} onClick={() => onChange(p)}
          className={`px-2 py-1 text-xs rounded ${p === page ? 'bg-blue-600 text-white font-bold' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-slate-500 text-xs px-1">…</span>}
          <button onClick={() => onChange(totalPages)} className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600">{totalPages}</button>
        </>
      )}
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30">›</button>
      <span className="text-xs text-slate-500 ml-2">{total}건 / {totalPages}페이지</span>
    </div>
  )
}

const MAX_MS = 48 * 60 * 60 * 1000

function formatDt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Renders a single filter group box. */
function FilterGroupBox({
  group, groupIndex, totalGroups,
  onChange, onAddCondition, onRemoveCondition, onRemoveGroup, onSearch,
}: {
  group: FilterGroup
  groupIndex: number
  totalGroups: number
  onChange: (gi: number, ci: number, field: 'key' | 'value', val: string) => void
  onAddCondition: (gi: number) => void
  onRemoveCondition: (gi: number, ci: number) => void
  onRemoveGroup: (gi: number) => void
  onSearch: () => void
}) {
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900 p-3">
      <div className="flex flex-col gap-1.5">
        {group.map((cond, ci) => (
          <div key={ci} className="flex items-center gap-2">
            {ci > 0 && (
              <span className="text-xs font-bold text-emerald-400 w-8 text-center select-none">AND</span>
            )}
            {ci === 0 && <div className="w-8" />}
            <input
              value={cond.key}
              onChange={e => onChange(groupIndex, ci, 'key', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSearch()}
              placeholder="필드 키 (예: header.id)"
              className="px-3 py-1.5 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-48"
            />
            <input
              value={cond.value}
              onChange={e => onChange(groupIndex, ci, 'value', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSearch()}
              placeholder="값 (비우면 존재 여부)"
              className="px-3 py-1.5 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-36"
            />
            {group.length > 1 && (
              <button
                onClick={() => onRemoveCondition(groupIndex, ci)}
                className="text-xs text-slate-500 hover:text-red-400 px-1"
                title="조건 삭제"
              >×</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700">
        <button
          onClick={() => onAddCondition(groupIndex)}
          className="text-xs text-slate-400 hover:text-white"
        >
          + AND 조건 추가
        </button>
        {totalGroups > 1 && (
          <button
            onClick={() => onRemoveGroup(groupIndex)}
            className="ml-auto text-xs text-slate-600 hover:text-red-400"
          >
            그룹 삭제
          </button>
        )}
      </div>
    </div>
  )
}

export default function LogPage() {
  const [groups, setGroups] = useState<FilterGroup[]>([[{ key: '', value: '' }]])
  const [fromDate, setFromDate] = useState(toLocalDateTimeStr(24))
  const [toDate, setToDate] = useState(toLocalDateTimeStr(0))

  const [result, setResult] = useState<TraceSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  function addGroup() {
    setGroups(g => [...g, [{ key: '', value: '' }]])
  }

  function removeGroup(gi: number) {
    setGroups(g => g.filter((_, i) => i !== gi))
  }

  function addCondition(gi: number) {
    setGroups(g => g.map((group, i) => i === gi ? [...group, { key: '', value: '' }] : group))
  }

  function removeCondition(gi: number, ci: number) {
    setGroups(g => g.map((group, i) => i === gi ? group.filter((_, j) => j !== ci) : group))
  }

  function updateCondition(gi: number, ci: number, field: 'key' | 'value', val: string) {
    setGroups(g => g.map((group, i) =>
      i === gi ? group.map((cond, j) => j === ci ? { ...cond, [field]: val } : cond) : group
    ))
  }

  function handleFromChange(val: string) {
    setFromDate(val)
    if (new Date(toDate).getTime() - new Date(val).getTime() > MAX_MS)
      setToDate(formatDt(new Date(new Date(val).getTime() + MAX_MS)))
  }

  function handleToChange(val: string) {
    setToDate(val)
    if (new Date(val).getTime() - new Date(fromDate).getTime() > MAX_MS)
      setFromDate(formatDt(new Date(new Date(val).getTime() - MAX_MS)))
  }

  const search = async () => {
    setLoading(true)
    setError(null)
    setPage(1)
    try {
      const res = await axios.post('/synapse/logs/trace', {
        filterGroups: groups,
        fromDate,
        toDate,
      })
      setResult(res.data.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const traces = [...(result?.traces ?? [])].reverse()
  const totalPages = Math.ceil(traces.length / PAGE_SIZE)
  const pageTraces = traces.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const activeGroups = result?.filterGroups.filter(g => g.some(c => c.key || c.value)) ?? []

  return (
    <div className="p-6 h-full overflow-auto">
      <h1 className="text-xl font-bold text-white mb-6">메세지 추적 로그</h1>

      {/* Search form */}
      <div className="mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">

        {/* Filter groups */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate-400 font-medium">필터 조건</span>
        </div>

        <div className="flex flex-col gap-0">
          {groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <div className="flex-1 border-t border-dashed border-slate-700" />
                  <span className="text-xs font-bold text-orange-400 px-2 py-0.5 rounded border border-orange-800 bg-orange-950/30">OR</span>
                  <div className="flex-1 border-t border-dashed border-slate-700" />
                </div>
              )}
              <FilterGroupBox
                group={group}
                groupIndex={gi}
                totalGroups={groups.length}
                onChange={updateCondition}
                onAddCondition={addCondition}
                onRemoveCondition={removeCondition}
                onRemoveGroup={removeGroup}
                onSearch={search}
              />
            </div>
          ))}
        </div>

        <button
          onClick={addGroup}
          className="mt-3 text-xs text-slate-400 hover:text-white border border-dashed border-slate-600 hover:border-slate-400 rounded px-3 py-1.5 w-full"
        >
          + OR 그룹 추가
        </button>

        {/* Date range + search */}
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-700 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">시작</label>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={e => handleFromChange(e.target.value)}
              className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">종료 (최대 48시간)</label>
            <input
              type="datetime-local"
              value={toDate}
              onChange={e => handleToChange(e.target.value)}
              className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={search}
            disabled={loading}
            className="px-5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {loading ? '검색 중...' : '검색'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 mb-4 text-sm text-slate-400">
          <svg className="animate-spin h-4 w-4 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          로그 파일을 검색하는 중입니다...
        </div>
      )}

      {error && <div className="text-red-400 mb-4 text-sm">{error}</div>}

      {/* Result header */}
      {result && (
        <div className="text-sm text-slate-400 mb-4 flex flex-wrap items-center gap-1">
          {activeGroups.length > 0 ? (
            <>
              {activeGroups.map((group, gi) => (
                <span key={gi} className="flex items-center gap-1">
                  {gi > 0 && <span className="text-orange-400 font-bold text-xs mx-1">OR</span>}
                  {group.length > 1 && <span className="text-slate-500">(</span>}
                  {group.filter(c => c.key || c.value).map((c, ci) => (
                    <span key={ci} className="flex items-center gap-1">
                      {ci > 0 && <span className="text-emerald-400 font-bold text-xs mx-0.5">AND</span>}
                      <span className="text-white font-mono">{c.key}</span>
                      {c.value && <> = <span className="text-blue-400 font-mono">"{c.value}"</span></>}
                    </span>
                  ))}
                  {group.length > 1 && <span className="text-slate-500">)</span>}
                </span>
              ))}
              <span className="mx-1">—</span>
            </>
          ) : (
            <span className="text-slate-500">필터 없음 — </span>
          )}
          <span className="text-white">{traces.length}건</span>
          {traces.length > PAGE_SIZE && (
            <span className="text-slate-500 ml-1">(페이지 {page} / {totalPages})</span>
          )}
        </div>
      )}

      {/* Trace list */}
      {traces.length === 0 && !loading && result && (
        <div className="text-slate-500 text-center py-12">
          {activeGroups.length > 0 ? '조건에 맞는 메세지 없음' : '해당 시간 범위에 로그 없음'}
        </div>
      )}
      {pageTraces.map((trace, i) => (
        <TraceCard key={i} trace={trace} />
      ))}

      <Pagination total={traces.length} page={page} onChange={setPage} />
    </div>
  )
}
