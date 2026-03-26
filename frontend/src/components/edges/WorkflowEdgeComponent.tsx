import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react'

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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#60a5fa' : '#64748b',
          strokeWidth: selected ? 2.5 : 2,
        }}
        markerEnd={`url(#arrow-${selected ? 'selected' : 'default'})`}
      />

      {/* Arrow markers definition */}
      <defs>
        <marker id="arrow-default" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
        </marker>
        <marker id="arrow-selected" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
        </marker>
      </defs>

      {/* Action bar - shown when selected */}
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
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
        </EdgeLabelRenderer>
      )}
    </>
  )
}
