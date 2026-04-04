import { useState } from 'react'
import { useWorkflowStore } from '../store/workflowStore'
import { ProtocolType, WorkflowUnit } from '../types/workflow'
import { useResizablePanel } from '../hooks/useResizablePanel'
import CreateUnitModal from './CreateUnitModal'

const PROTOCOL_LABEL: Record<ProtocolType, string> = {
  WEBSOCKET_SERVER: 'WS Server',
  WEBSOCKET_CLIENT: 'WS Client',
  TCP_SERVER: 'TCP Server',
  TCP_CLIENT: 'TCP Client',
  KAFKA_CONSUMER: 'Kafka',
  KAFKA_PUBLISHER: 'Kafka Pub',
  REST_SERVER: 'REST',
}

const PROTOCOL_COLOR: Record<ProtocolType, string> = {
  WEBSOCKET_SERVER: 'bg-emerald-700 text-emerald-100',
  WEBSOCKET_CLIENT: 'bg-emerald-800 text-emerald-200',
  TCP_SERVER: 'bg-blue-700 text-blue-100',
  TCP_CLIENT: 'bg-blue-800 text-blue-200',
  KAFKA_CONSUMER: 'bg-orange-700 text-orange-100',
  KAFKA_PUBLISHER: 'bg-orange-800 text-orange-200',
  REST_SERVER: 'bg-violet-700 text-violet-100',
}

function getNode0Protocol(unit: WorkflowUnit): ProtocolType | null {
  const node0 = unit.nodes.find((n) => n.nodeType === 'NODE0')
  return node0?.node0?.protocol ?? null
}

export default function WorkflowUnitList() {
  const { units, selectedUnitId, selectUnit, loading, deleteUnit } = useWorkflowStore()
  const { width, onHandleMouseDown } = useResizablePanel(256, {
    direction: 'right',
    storageKey: 'panel-left-width',
    min: 160,
    max: 520,
  })
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteBy, setDeleteBy] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const filtered = (units ?? []).filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleDeleteConfirm = async () => {
    if (!deletingId || !deleteBy || !deletePassword) return
    try {
      await deleteUnit(deletingId, deleteBy, deletePassword)
      setDeletingId(null)
      setDeletePassword('')
      setDeleteBy('')
      setDeleteError(null)
    } catch (e: any) {
      setDeleteError(e.response?.data?.error ?? e.message)
    }
  }

  return (
    <>
      <div
        className="relative bg-slate-900 border-r border-slate-700 flex flex-col shrink-0"
        style={{ width }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={onHandleMouseDown}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize z-10 group"
        >
          <div className="absolute inset-y-0 right-0 w-0.5 bg-transparent group-hover:bg-blue-500/50 transition-colors" />
        </div>
        <div className="p-3 border-b border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">워크플로우 단위</span>
          </div>
          <input
            type="text"
            placeholder="검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-2 py-1 text-sm rounded bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-3 text-sm text-slate-400">로딩 중...</div>}
          {filtered.map((unit) => (
            <div
              key={unit.id}
              className={`group flex items-stretch border-b border-slate-800 ${
                selectedUnitId === unit.id ? 'bg-blue-900/50 border-l-2 border-l-blue-500' : 'hover:bg-slate-800'
              }`}
            >
              <button
                onClick={() => selectUnit(unit.id)}
                className="flex-1 text-left px-3 py-2 text-sm min-w-0"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`font-medium truncate flex-1 ${selectedUnitId === unit.id ? 'text-blue-300' : 'text-slate-300'}`}>
                    {unit.name}
                  </div>
                  {(() => {
                    const proto = getNode0Protocol(unit)
                    return proto ? (
                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${PROTOCOL_COLOR[proto]}`}>
                        {PROTOCOL_LABEL[proto]}
                      </span>
                    ) : null
                  })()}
                </div>
                <div className="text-xs text-slate-500 truncate mt-0.5">
                  {unit.condition.rawExpression ?? unit.condition.type}
                </div>
              </button>
              <button
                onClick={() => { setDeletingId(unit.id); setDeleteError(null) }}
                className="px-2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="p-3 text-sm text-slate-500 text-center">
              워크플로우 단위가 없습니다
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-700">
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            + 새 워크플로우 단위
          </button>
        </div>
      </div>

      {/* Create unit modal */}
      {showCreateModal && <CreateUnitModal onClose={() => setShowCreateModal(false)} />}

      {/* Delete confirm modal */}
      {deletingId && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setDeletingId(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-80 bg-slate-900 rounded-xl border border-red-800 shadow-2xl pointer-events-auto p-5 space-y-4">
              <div className="text-base font-semibold text-white">워크플로우 단위 삭제</div>
              <div className="text-sm text-slate-400">
                삭제 후 복구하려면 히스토리에서 롤백해야 합니다. 삭제 인증을 입력하세요.
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  value={deleteBy}
                  onChange={(e) => setDeleteBy(e.target.value)}
                  placeholder="수정자 이름"
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                />
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="비밀번호"
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                />
              </div>
              {deleteError && <div className="text-xs text-red-400">{deleteError}</div>}
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeletingId(null); setDeletePassword(''); setDeleteBy(''); setDeleteError(null) }}
                  className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
                >
                  취소
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 py-2 text-sm rounded bg-red-600 hover:bg-red-700 text-white font-medium"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
