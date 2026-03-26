import { useState } from 'react'
import axios from 'axios'

interface TraceLog {
  traceId: string
  workflowUnitId: string
  nodeType: string
  timestamp: string
  protocol: string
  messageSnippet: Record<string, any>
  status: 'SUCCESS' | 'ERROR'
  errorMessage?: string
}

export default function LogPage() {
  const [fieldKey, setFieldKey] = useState('')
  const [fieldValue, setFieldValue] = useState('')
  const [fromFiles, setFromFiles] = useState(false)
  const [days, setDays] = useState(7)
  const [logs, setLogs] = useState<TraceLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!fieldKey || !fieldValue) return
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get('/synapse/logs/search', {
        params: { fieldKey, fieldValue, fromFiles, days }
      })
      setLogs(res.data.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <h1 className="text-xl font-bold text-white mb-6">메세지 추적 로그</h1>

      {/* Search form */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">필드 키</label>
          <input
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            placeholder="예: header.trace_id"
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">값</label>
          <input
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
            placeholder="예: trace-550e84"
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">기간 (일)</label>
          <input
            type="number"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            min={1}
            max={7}
            className="px-3 py-2 rounded bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 w-20"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">파일 검색</label>
          <label className="flex items-center gap-2 h-9 cursor-pointer">
            <input
              type="checkbox"
              checked={fromFiles}
              onChange={(e) => setFromFiles(e.target.checked)}
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

      {/* Results */}
      <div className="space-y-2">
        {logs.length === 0 && !loading && (
          <div className="text-slate-500 text-center py-12">결과 없음</div>
        )}
        {logs.map((log, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg border ${
              log.status === 'ERROR'
                ? 'border-red-800 bg-red-950/30'
                : 'border-slate-700 bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                log.status === 'ERROR' ? 'bg-red-700 text-white' : 'bg-green-700 text-white'
              }`}>
                {log.status}
              </span>
              <span className="text-xs text-slate-400 font-mono">{log.timestamp}</span>
              <span className="text-xs text-slate-500">{log.nodeType}</span>
              <span className="text-xs text-slate-500">{log.protocol}</span>
            </div>
            <div className="text-xs text-slate-400 font-mono mb-1">traceId: {log.traceId}</div>
            {log.errorMessage && (
              <div className="text-xs text-red-400 mt-1">{log.errorMessage}</div>
            )}
            <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded mt-2 overflow-x-auto">
              {JSON.stringify(log.messageSnippet, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}
