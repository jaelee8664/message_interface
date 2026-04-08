import { useState } from 'react'
import { useHistoryStore, UnitDiff, NodeDiff } from '../store/historyStore'

type NodeStatus = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED'

const STATUS_ICON: Record<NodeStatus, string> = {
  ADDED:     '+',
  REMOVED:   '−',
  MODIFIED:  '~',
  UNCHANGED: '○',
}

const NODE_STATUS_COLOR: Record<NodeStatus, string> = {
  ADDED:     'text-green-400',
  REMOVED:   'text-red-400',
  MODIFIED:  'text-amber-400',
  UNCHANGED: 'text-slate-500',
}

const UNIT_STATUS_COLOR: Record<NodeStatus, string> = {
  ADDED:     'text-green-300',
  REMOVED:   'text-red-300',
  MODIFIED:  'text-amber-300',
  UNCHANGED: 'text-slate-400',
}

const UNIT_STATUS_LABEL: Record<NodeStatus, string> = {
  ADDED:     '추가됨',
  REMOVED:   '삭제됨',
  MODIFIED:  '수정됨',
  UNCHANGED: '동일',
}

interface Selected {
  unitId: string
  nodeIndex: number  // index in unit.nodeDiffs (unique even with duplicate nodeTypes)
}

export default function DiffModal() {
  const { diffResult, diffLoading, diffError, closeDiff } = useHistoryStore()
  const [selected, setSelected] = useState<Selected | null>(null)
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set())

  if (!diffResult && !diffLoading && !diffError) return null

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  const toggleUnit = (id: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleNodeClick = (unitId: string, nodeIndex: number) => {
    setSelected(prev =>
      prev?.unitId === unitId && prev?.nodeIndex === nodeIndex ? null : { unitId, nodeIndex }
    )
  }

  const selectedUnitDiff = selected
    ? diffResult?.unitDiffs.find(u => u.id === selected.unitId)
    : null
  const selectedNodeDiff = selected && selectedUnitDiff
    ? selectedUnitDiff.nodeDiffs[selected.nodeIndex] ?? null
    : null

  // Units auto-expanded when changed
  const isExpanded = (unit: UnitDiff) =>
    unit.status !== 'UNCHANGED' || expandedUnits.has(unit.id)

  return (
    <>
      {/* Backdrop — z-[70] so it's above the drawer (z-50) */}
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={closeDiff} />

      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 pointer-events-none">
        <div
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[880px] flex flex-col pointer-events-auto"
          style={{ maxHeight: '78vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700 shrink-0">
            {diffResult ? (
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-semibold text-white shrink-0">버전 비교</span>
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  <span className="px-2 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-800/40 shrink-0">
                    v{diffResult.version} · {diffResult.modifiedBy} · {formatDate(diffResult.modifiedAt)}
                  </span>
                  <span className="text-slate-600 shrink-0">→</span>
                  <span className="px-2 py-0.5 rounded bg-green-900/30 text-green-300 border border-green-800/40 shrink-0">
                    현재
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm font-semibold text-white">버전 비교</span>
            )}
            <button onClick={closeDiff} className="text-slate-400 hover:text-white text-xl leading-none ml-4 shrink-0">✕</button>
          </div>

          {/* ── Loading / Error ── */}
          {diffLoading && (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">비교 중...</div>
          )}
          {diffError && (
            <div className="flex items-center justify-center h-48 text-red-400 text-sm">{diffError}</div>
          )}

          {/* ── Trees ── */}
          {diffResult && (
            <>
              <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Before column */}
                <div className="w-1/2 border-r border-slate-700 flex flex-col min-h-0">
                  <div className="px-4 py-2 shrink-0 border-b border-slate-800 bg-red-900/10">
                    <span className="text-xs font-semibold text-red-400">BEFORE</span>
                    <span className="text-xs text-slate-500 ml-1.5">v{diffResult.version}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {diffResult.unitDiffs.map(unit => (
                      <UnitSection
                        key={unit.id}
                        unit={unit}
                        side="before"
                        expanded={isExpanded(unit)}
                        selected={selected}
                        onToggle={() => toggleUnit(unit.id)}
                        onNodeClick={handleNodeClick}
                      />
                    ))}
                  </div>
                </div>

                {/* After column */}
                <div className="w-1/2 flex flex-col min-h-0">
                  <div className="px-4 py-2 shrink-0 border-b border-slate-800 bg-green-900/10">
                    <span className="text-xs font-semibold text-green-400">AFTER</span>
                    <span className="text-xs text-slate-500 ml-1.5">현재</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {diffResult.unitDiffs.map(unit => (
                      <UnitSection
                        key={unit.id}
                        unit={unit}
                        side="after"
                        expanded={isExpanded(unit)}
                        selected={selected}
                        onToggle={() => toggleUnit(unit.id)}
                        onNodeClick={handleNodeClick}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Field diff panel ── */}
              <div
                className="border-t border-slate-700 shrink-0 transition-all overflow-hidden"
                style={{ maxHeight: selectedNodeDiff ? '220px' : '38px' }}
              >
                {/* Panel header — always visible as a hint */}
                <div className="px-4 py-2 bg-slate-800/60 flex items-center gap-2">
                  {selectedNodeDiff ? (
                    <>
                      <span className="text-xs font-semibold text-white">{selectedNodeDiff.nodeType}</span>
                      <span className="text-xs text-slate-500">·</span>
                      <span className="text-xs text-slate-400">{selectedUnitDiff?.beforeName ?? selectedUnitDiff?.afterName}</span>
                      <span className={`ml-auto text-xs font-medium ${NODE_STATUS_COLOR[selectedNodeDiff.status as NodeStatus]}`}>
                        {selectedNodeDiff.status === 'UNCHANGED' ? '변경 없음'
                          : selectedNodeDiff.status === 'ADDED' ? '추가됨'
                          : selectedNodeDiff.status === 'REMOVED' ? '삭제됨'
                          : `${selectedNodeDiff.fieldDiffs.length}개 필드 변경`}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">노드를 클릭하면 필드 변경 사항이 표시됩니다</span>
                  )}
                </div>

                {/* Field diff table */}
                {selectedNodeDiff && selectedNodeDiff.status !== 'UNCHANGED' && (
                  <div className="overflow-y-auto" style={{ maxHeight: '182px' }}>
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="border-b border-slate-800 text-slate-500">
                          <th className="px-4 py-1.5 text-left font-medium w-36">필드</th>
                          <th className="px-4 py-1.5 text-left font-medium w-[45%]">Before</th>
                          <th className="px-4 py-1.5 text-left font-medium">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedNodeDiff.fieldDiffs.length === 0 && (
                          // ADDED / REMOVED — show all fields from nodedef
                          <tr>
                            <td colSpan={3} className="px-4 py-3 text-slate-500 text-center">
                              {selectedNodeDiff.status === 'ADDED' ? '이 노드는 현재 버전에서 새로 추가되었습니다.' : '이 노드는 현재 버전에서 삭제되었습니다.'}
                            </td>
                          </tr>
                        )}
                        {selectedNodeDiff.fieldDiffs.map((fd, i) => (
                          <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                            <td className="px-4 py-1.5 font-mono text-slate-400 align-top">{fd.field}</td>
                            <td className="px-4 py-1.5 align-top">
                              {fd.before !== null
                                ? <code className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800/30 break-all whitespace-pre-wrap">{fd.before}</code>
                                : <span className="text-slate-600">—</span>
                              }
                            </td>
                            <td className="px-4 py-1.5 align-top">
                              {fd.after !== null
                                ? <code className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-800/30 break-all whitespace-pre-wrap">{fd.after}</code>
                                : <span className="text-slate-600">—</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedNodeDiff?.status === 'UNCHANGED' && (
                  <div className="px-4 py-3 text-xs text-slate-500">두 버전에서 동일한 노드입니다.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── UnitSection ───────────────────────────────────────────────────────────────

interface UnitSectionProps {
  unit: UnitDiff
  side: 'before' | 'after'
  expanded: boolean
  selected: Selected | null
  onToggle: () => void
  onNodeClick: (unitId: string, nodeIndex: number) => void
}

function UnitSection({ unit, side, expanded, selected, onToggle, onNodeClick }: UnitSectionProps) {
  const status = unit.status as NodeStatus
  const name = side === 'before' ? unit.beforeName : unit.afterName

  // Show placeholder when unit doesn't exist on this side
  if (status === 'ADDED' && side === 'before') {
    return (
      <div className="border-b border-slate-800 px-4 py-2.5 flex items-center gap-2">
        <span className="text-xs text-green-900/60 italic">
          [{unit.afterName}] — 이 버전에 없음
        </span>
      </div>
    )
  }
  if (status === 'REMOVED' && side === 'after') {
    return (
      <div className="border-b border-slate-800 px-4 py-2.5 flex items-center gap-2">
        <span className="text-xs text-red-900/60 italic">
          [{unit.beforeName}] — 현재 삭제됨
        </span>
      </div>
    )
  }

  // Nodes visible on this side, keep original index for unique selection key
  const visibleNodes = unit.nodeDiffs
    .map((n, idx) => ({ node: n, idx }))
    .filter(({ node }) => side === 'before'
      ? (node.status as NodeStatus) !== 'ADDED'
      : (node.status as NodeStatus) !== 'REMOVED'
    )

  return (
    <div className="border-b border-slate-800">
      {/* Unit header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800/40 transition-colors text-left"
        onClick={onToggle}
      >
        <span className={`text-xs font-bold w-3 shrink-0 ${NODE_STATUS_COLOR[status]}`}>
          {STATUS_ICON[status]}
        </span>
        <span className={`text-xs font-semibold flex-1 truncate ${UNIT_STATUS_COLOR[status]}`}>{name}</span>
        <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded ${
          status === 'MODIFIED' ? 'bg-amber-900/40 text-amber-400' :
          status === 'ADDED'    ? 'bg-green-900/40 text-green-400' :
          status === 'REMOVED'  ? 'bg-red-900/40 text-red-400' :
          'bg-slate-800 text-slate-500'
        }`}>
          {UNIT_STATUS_LABEL[status]}
        </span>
        <span className="text-slate-600 text-[10px] ml-1">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Node list */}
      {expanded && (
        <div className="pb-1.5">
          {visibleNodes.length === 0 && (
            <div className="px-8 py-1.5 text-xs text-slate-600">노드 없음</div>
          )}
          {visibleNodes.map(({ node, idx }) => {
            const ns = node.status as NodeStatus
            const isSelected = selected?.unitId === unit.id && selected?.nodeIndex === idx
            return (
              <button
                key={idx}
                onClick={() => onNodeClick(unit.id, idx)}
                className={`w-full flex items-center gap-2 px-8 py-1.5 text-xs text-left transition-colors ${
                  isSelected ? 'bg-indigo-900/40 border-l-2 border-indigo-500' : 'hover:bg-slate-800/40'
                }`}
              >
                <span className={`font-bold w-3 shrink-0 ${NODE_STATUS_COLOR[ns]}`}>
                  {STATUS_ICON[ns]}
                </span>
                <span className={NODE_STATUS_COLOR[ns]}>{node.nodeType}</span>
                {ns === 'MODIFIED' && node.fieldDiffs.length > 0 && (
                  <span className="ml-auto text-[10px] text-amber-500/70">
                    {node.fieldDiffs.length}개 변경
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
