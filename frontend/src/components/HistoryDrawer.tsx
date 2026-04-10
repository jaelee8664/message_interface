import { useEffect, useState } from 'react'
import { useHistoryStore, HistoryEntry } from '../store/historyStore'
import { useWorkflowStore } from '../store/workflowStore'
import DiffModal from './DiffModal'

export default function HistoryDrawer() {
  const { entries, isOpen, loading, error, closeDrawer, fetchHistory, rollback, openDiff, diffLoading } = useHistoryStore()
  const { fetchUnits } = useWorkflowStore()
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [modifiedBy, setModifiedBy] = useState('')
  const [password, setPassword] = useState('')
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const [rollbackLoading, setRollbackLoading] = useState(false)

  useEffect(() => {
    if (isOpen) fetchHistory()
  }, [isOpen])

  if (!isOpen) return null

  const handleRollback = async () => {
    if (!rollbackTarget || !modifiedBy || !password) return
    setRollbackError(null)
    setRollbackLoading(true)
    try {
      await rollback(rollbackTarget, modifiedBy, password)
      await fetchUnits()
      setRollbackTarget(null)
      setModifiedBy('')
      setPassword('')
    } catch (e: any) {
      setRollbackError(e.response?.data?.error ?? e.message)
    } finally {
      setRollbackLoading(false)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    } catch {
      return iso
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={closeDrawer} />

      <div className="fixed right-0 top-0 h-full w-[420px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <div className="text-base font-semibold text-white">수정 히스토리</div>
            <div className="text-xs text-slate-400 mt-0.5">최근 10개의 워크플로우 변경 이력</div>
          </div>
          <button onClick={closeDrawer} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">로딩 중...</div>
          )}
          {!loading && entries.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">히스토리가 없습니다</div>
          )}
          {!loading && entries.map((entry) => (
            <HistoryEntryCard
              key={entry.version}
              entry={entry}
              isRollbackTarget={rollbackTarget === entry.version}
              diffLoading={diffLoading}
              onRollbackClick={() => {
                setRollbackTarget(entry.version)
                setRollbackError(null)
                setModifiedBy('')
                setPassword('')
              }}
              onRollbackCancel={() => setRollbackTarget(null)}
              onDiffClick={() => openDiff(entry.version)}
              modifiedBy={modifiedBy}
              password={password}
              onModifiedByChange={setModifiedBy}
              onPasswordChange={setPassword}
              rollbackError={rollbackError}
              rollbackLoading={rollbackLoading}
              onRollbackConfirm={handleRollback}
              formatDate={formatDate}
            />
          ))}
        </div>

        {error && (
          <div className="px-5 py-3 border-t border-slate-700 text-xs text-red-400">{error}</div>
        )}
      </div>

      <DiffModal />
    </>
  )
}

interface CardProps {
  entry: HistoryEntry
  isRollbackTarget: boolean
  diffLoading: boolean
  onRollbackClick: () => void
  onRollbackCancel: () => void
  onDiffClick: () => void
  modifiedBy: string
  password: string
  onModifiedByChange: (v: string) => void
  onPasswordChange: (v: string) => void
  rollbackError: string | null
  rollbackLoading: boolean
  onRollbackConfirm: () => void
  formatDate: (s: string) => string
}

function HistoryEntryCard({
  entry, isRollbackTarget, diffLoading,
  onRollbackClick, onRollbackCancel, onDiffClick,
  modifiedBy, password, onModifiedByChange, onPasswordChange,
  rollbackError, rollbackLoading, onRollbackConfirm, formatDate,
}: CardProps) {
  return (
    <div className={`border-b border-slate-800 transition-colors ${isRollbackTarget ? 'bg-blue-950/30' : 'hover:bg-slate-800/50'}`}>
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
          v{entry.version}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-white truncate">{entry.modifiedBy}</span>
            <span className="text-xs text-slate-500 shrink-0">{formatDate(entry.modifiedAt)}</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.units.slice(0, 5).map((u) => (
              <span key={u.id} className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-300 truncate max-w-[140px]">
                {u.name}
              </span>
            ))}
            {entry.units.length > 5 && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-400">
                +{entry.units.length - 5}개
              </span>
            )}
            {entry.units.length === 0 && (
              <span className="text-xs text-slate-500">(빈 워크플로우)</span>
            )}
          </div>
        </div>

        {!isRollbackTarget && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={onDiffClick}
              disabled={diffLoading}
              className="px-2.5 py-1 text-xs rounded border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-40 transition-colors"
            >
              비교
            </button>
            <button
              onClick={onRollbackClick}
              className="px-2.5 py-1 text-xs rounded border border-amber-600/50 text-amber-400 hover:bg-amber-600/10 transition-colors"
            >
              복원
            </button>
          </div>
        )}
      </div>

      {isRollbackTarget && (
        <div className="px-5 pb-4 space-y-3">
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            v{entry.version}으로 복원합니다. 현재 상태는 히스토리로 저장됩니다.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={modifiedBy}
              onChange={(e) => onModifiedByChange(e.target.value)}
              placeholder="수정자 이름"
              className="flex-1 px-3 py-2 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="비밀번호"
              className="flex-1 px-3 py-2 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          {rollbackError && <div className="text-xs text-red-400">{rollbackError}</div>}
          <div className="flex gap-2">
            <button
              onClick={onRollbackCancel}
              className="flex-1 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white"
            >
              취소
            </button>
            <button
              onClick={onRollbackConfirm}
              disabled={rollbackLoading || !modifiedBy || !password}
              className="flex-1 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white font-medium disabled:opacity-50"
            >
              {rollbackLoading ? '복원 중...' : `v${entry.version}으로 복원`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
