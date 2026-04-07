import { Handle, Position, NodeProps } from '@xyflow/react'
import { useSimContext } from '../../context/SimContext'

interface WorkflowNodeData {
  nodeType: string
  label: string
  color: string
  definition: any
  unitId: string
}

export default function WorkflowNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as WorkflowNodeData
  const { traceMap, activeNodeId } = useSimContext()
  const trace = traceMap[id]
  const isActive = activeNodeId === id
  const isError = trace?.status === 'ERROR'

  return (
    <div
      className="rounded-lg border-2 p-3 min-w-[200px] cursor-pointer relative"
      style={{
        borderColor: isActive
          ? '#facc15'
          : trace
            ? (isError ? '#f87171' : '#4ade80')
            : selected ? d.color : `${d.color}66`,
        background: '#1e293b',
        boxShadow: isActive
          ? '0 0 14px #facc1566'
          : trace
            ? (isError ? '0 0 8px #f8717133' : '0 0 8px #4ade8033')
            : selected ? `0 0 12px ${d.color}88` : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.color }} />
      <div className="flex items-center gap-2 mb-1">
        <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
        <span className="text-xs text-slate-400 font-mono">{d.nodeType}</span>
      </div>
      <div className="text-sm font-semibold text-white">{d.label}</div>
      {d.definition && (
        <div className="mt-1 text-xs text-slate-400 truncate">
          {getDefinitionSummary(d.nodeType, d.definition)}
        </div>
      )}
      {d.nodeType === 'NODE3' && (() => {
        const count = (d.definition?.mappings ?? [])
          .filter((m: any) => m.filterCode || (m.listAddItems?.length ?? 0) > 0)
          .length
        if (count === 0) return null
        return (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-teal-300 bg-teal-950/60 border border-teal-700/50 rounded px-1.5 py-0.5 w-fit">
            <span>⚙</span>
            <span>커스텀 {count}개</span>
          </div>
        )
      })()}
      <Handle type="source" position={Position.Right} style={{ background: d.color }} />

      {/* Sim trace badge */}
      {trace && (
        <div
          className={`absolute -top-2.5 -right-2.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold shadow-lg pointer-events-none ${
            isError ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          <span>{isError ? '✕' : '✓'}</span>
          <span>{trace.durationMs}ms</span>
        </div>
      )}
    </div>
  )
}

function getDefinitionSummary(nodeType: string, def: any): string {
  switch (nodeType) {
    case 'NODE0': return `${def.protocol ?? ''} ${def.host ?? ''} ${def.port ?? ''}`
    case 'NODE1': return `${def.messageFormat ?? ''} · ${def.fields?.length ?? 0}개 필드`
    case 'NODE2': return `치환 ${def.valueReplaceRules?.length ?? 0} · 변환 ${def.typeConvertRules?.length ?? 0} · 커스텀 ${def.customCodeRules?.length ?? 0}`
    case 'NODE3': return `${def.mappings?.length ?? 0}개 매핑`
    case 'NODE4': return `${def.messageFormat ?? ''} → ${def.protocol ?? ''}`
    case 'NODE5':
      return `HTTP 응답 · ${def.successConfig?.httpStatus ?? 200}`
    default: return ''
  }
}
