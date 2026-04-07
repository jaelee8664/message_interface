import { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import { useSimContext } from '../../context/SimContext'

export interface WorkflowEdgeData {
  onDeleteEdge: (edgeId: string) => void
}

export default function WorkflowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const edgeData = data as WorkflowEdgeData | undefined
  const { edgeSnapshotMap } = useSimContext()
  const snapshot = edgeSnapshotMap[id]
  const hasSnapshot = !!snapshot && Object.keys(snapshot).length > 0
  const [showPopover, setShowPopover] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  // When selected and snapshot both exist, offset delete button upward
  const deleteLabelY = hasSnapshot ? labelY - 28 : labelY

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#60a5fa' : hasSnapshot ? '#4ade80' : '#64748b',
          strokeWidth: selected ? 2.5 : 2,
        }}
        markerEnd={`url(#arrow-${selected ? 'selected' : hasSnapshot ? 'traced' : 'default'})`}
      />

      <defs>
        <marker id="arrow-default" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
        </marker>
        <marker id="arrow-selected" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
        </marker>
        <marker id="arrow-traced" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#4ade80" />
        </marker>
      </defs>

      <EdgeLabelRenderer>
        {/* Snapshot badge at edge midpoint */}
        {hasSnapshot && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowPopover(v => !v)
                }}
                className="w-5 h-5 rounded-full bg-green-800 border border-green-500 text-green-300 text-xs flex items-center justify-center hover:bg-green-700 shadow-md font-mono leading-none"
                title="엣지 통과 데이터 보기"
              >
                {'{'}
              </button>

              {showPopover && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 bottom-7 w-64 bg-slate-900 border border-slate-600 rounded-lg shadow-2xl z-50 p-2"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-400 font-medium">엣지 통과 데이터</span>
                    <button
                      onClick={() => setShowPopover(false)}
                      className="text-slate-500 hover:text-slate-300 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <pre className="text-xs bg-slate-950 rounded p-2 overflow-auto max-h-52 text-slate-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(snapshot, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Delete button — shown when selected, offset up if snapshot badge is present */}
        {selected && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${deleteLabelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 border border-blue-500 shadow-lg shadow-blue-500/20">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  edgeData?.onDeleteEdge(id)
                }}
                className="px-1.5 py-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-900/30 text-xs transition-colors"
                title="엣지 삭제"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
