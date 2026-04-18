import { useState, useEffect, useRef } from 'react'
import { usePanelStore } from '../../store/panelStore'
import { useAuthStore } from '../../store/authStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { WorkflowCondition, WorkflowNode } from '../../types/workflow'
import Node0Panel from './Node0Panel'
import Node1Panel from './Node1Panel'
import Node2Panel from './Node2Panel'
import Node3Panel, { Node3PanelHandle } from './Node3Panel'
import Node4Panel from './Node4Panel'
import Node5Panel from './Node5Panel'
import NodeErrorResponseSection from './NodeErrorResponseSection'
import { deriveSessionVars } from '../ui/SessionVarPicker'

const NODE_LABELS: Record<string, string> = {
  NODE0: '수신 프로토콜',
  NODE1: 'Input DTO 정의',
  NODE2: '값 변환',
  NODE3: 'Output DTO 매핑',
  NODE4: '송신 설정',
  NODE5: '응답 설정',
}

const NODE_COLORS: Record<string, string> = {
  NODE0: '#3b82f6',
  NODE1: '#8b5cf6',
  NODE2: '#f59e0b',
  NODE3: '#10b981',
  NODE4: '#ef4444',
  NODE5: '#06b6d4',
}

export default function NodeSettingsPanel() {
  const { isOpen, activeNode, activeUnit, closePanel, onDeleteNode, onUpdateNode, onUpdateCondition } = usePanelStore()
  const { canWrite } = useAuthStore()
  const { width, onHandleMouseDown } = useResizablePanel(384, {
    direction: 'left',
    storageKey: 'panel-right-width',
    min: 300,
    max: 800,
  })

  const [editingNode, setEditingNode] = useState<WorkflowNode | null>(null)
  const [editingCondition, setEditingCondition] = useState<WorkflowCondition | null>(null)
  const node3Ref = useRef<Node3PanelHandle>(null)

  useEffect(() => {
    if (activeNode) setEditingNode({ ...activeNode })
    if (activeNode?.nodeType === 'NODE0' && activeUnit?.condition) {
      setEditingCondition({ ...activeUnit.condition })
    }
  }, [activeNode, activeUnit])

  if (!isOpen || !editingNode || !activeUnit) return null

  const sessionVars = deriveSessionVars(activeUnit.nodes)

  const updateDefinition = (def: any) => {
    const nodeType = editingNode.nodeType
    setEditingNode({
      ...editingNode,
      node0: nodeType === 'NODE0' ? def : editingNode.node0,
      node1: nodeType === 'NODE1' ? def : editingNode.node1,
      node2: nodeType === 'NODE2' ? def : editingNode.node2,
      node3: nodeType === 'NODE3' ? def : editingNode.node3,
      node4: nodeType === 'NODE4' ? def : editingNode.node4,
      node5: nodeType === 'NODE5' ? def : editingNode.node5,
    })
  }

  const handleConfirm = () => {
    let nodeToSave = editingNode
    if (editingNode?.nodeType === 'NODE3' && node3Ref.current) {
      const updatedDef = node3Ref.current.getUpdatedDefinition()
      if (updatedDef) nodeToSave = { ...editingNode, node3: updatedDef }
    }
    if (nodeToSave && onUpdateNode) onUpdateNode(nodeToSave)
    if (editingNode?.nodeType === 'NODE0' && editingCondition && onUpdateCondition) {
      onUpdateCondition(editingCondition)
    }
    closePanel()
  }

  const color = NODE_COLORS[editingNode.nodeType] ?? '#64748b'
  const label = NODE_LABELS[editingNode.nodeType] ?? editingNode.nodeType

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={closePanel} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl"
        style={{ width }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={onHandleMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-10 group"
        >
          <div className="absolute inset-y-0 left-0 w-0.5 bg-transparent group-hover:bg-blue-500/50 transition-colors" />
        </div>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-slate-700"
          style={{ borderLeftColor: color, borderLeftWidth: 4 }}
        >
          <div className="w-3 h-3 rounded-full" style={{ background: color }} />
          <div className="flex-1">
            <div className="text-xs text-slate-400 font-mono">{editingNode.nodeType}</div>
            <div className="text-sm font-semibold text-white">{label}</div>
          </div>
          <button onClick={closePanel} className="text-slate-400 hover:text-white text-lg leading-none">&#10005;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {editingNode.nodeType === 'NODE0' && (
            <Node0Panel
              definition={editingNode.node0}
              onChange={updateDefinition}
              condition={editingCondition ?? undefined}
              onConditionChange={setEditingCondition}
              unitId={activeUnit.id}
            />
          )}
          {editingNode.nodeType === 'NODE1' && (() => {
            const node0Protocol = activeUnit?.nodes.find(n => n.nodeType === 'NODE0')?.node0?.protocol
            const isGrpc = node0Protocol === 'GRPC_SERVER' || node0Protocol === 'GRPC_CLIENT'
            return (
              <Node1Panel
                key={editingNode.id}
                definition={editingNode.node1}
                onChange={updateDefinition}
                isGrpc={isGrpc}
              />
            )
          })()}
          {editingNode.nodeType === 'NODE2' && (
            <Node2Panel definition={editingNode.node2} onChange={updateDefinition} unitId={activeUnit.id} />
          )}
          {editingNode.nodeType === 'NODE3' && (
            <Node3Panel
              ref={node3Ref}
              definition={editingNode.node3}
              onChange={updateDefinition}
              currentNodeId={editingNode.id}
              unit={activeUnit}
            />
          )}
          {editingNode.nodeType === 'NODE4' && (
            <Node4Panel definition={editingNode.node4} onChange={updateDefinition} unitId={activeUnit.id} sessionVars={sessionVars} />
          )}
          {editingNode.nodeType === 'NODE5' && (
            <Node5Panel definition={editingNode.node5} onChange={updateDefinition} sessionVars={sessionVars} />
          )}
          {/* Per-node error response override (NODE0~NODE4 only; NODE5 has its own default) */}
          {editingNode.nodeType !== 'NODE5' && (
            <NodeErrorResponseSection
              errorResponse={editingNode.errorResponse}
              onChange={(r) =>
                setEditingNode({ ...editingNode, errorResponse: r ?? undefined })
              }
              sessionVars={sessionVars}
            />
          )}

          {/* Custom error message (common to all nodes) */}
          <div className="mt-4 pt-4 border-t border-slate-700/60">
            <label className="block text-xs font-medium text-slate-400 mb-1">커스텀 예외 메세지 (선택)</label>
            <input
              type="text"
              value={editingNode.customErrorMessage ?? ''}
              onChange={(e) =>
                setEditingNode({ ...editingNode, customErrorMessage: e.target.value || undefined })
              }
              placeholder="오류 발생 시 상위 시스템에 전달할 메세지"
              className="w-full px-3 py-1.5 text-xs rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">비워두면 기본 예외 메세지를 사용합니다.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 space-y-3">
          <p className="text-xs text-slate-500">변경사항은 오른쪽 위 저장 버튼으로 최종 저장하세요.</p>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="flex-1 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              확인
            </button>
            <button
              onClick={closePanel}
              className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
            >
              닫기
            </button>
          </div>
          {/* Delete node — admin only */}
          {canWrite() && (
            <button
              onClick={() => {
                if (editingNode && onDeleteNode) {
                  onDeleteNode(editingNode.id)
                  closePanel()
                }
              }}
              className="w-full py-1.5 text-xs rounded border border-red-800/60 text-red-400 hover:bg-red-900/20 transition-colors"
            >
              이 노드 삭제 (캔버스에서 제거)
            </button>
          )}
        </div>
      </div>
    </>
  )
}
