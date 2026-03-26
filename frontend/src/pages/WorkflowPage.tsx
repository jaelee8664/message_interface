import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  BackgroundVariant,
  NodeChange,
  EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useWorkflowStore } from '../store/workflowStore'
import { usePanelStore } from '../store/panelStore'
import { useHistoryStore } from '../store/historyStore'
import { workflowUnitToFlow, flowToWorkflowUnit } from '../utils/workflowToFlow'
import { applyDagreLayout } from '../utils/autoLayout'
import WorkflowNodeComponent from '../components/nodes/WorkflowNodeComponent'
import WorkflowEdgeComponent from '../components/edges/WorkflowEdgeComponent'
import WorkflowUnitList from '../components/WorkflowUnitList'
import NodeSettingsPanel from '../components/panels/NodeSettingsPanel'
import HistoryDrawer from '../components/HistoryDrawer'
import { generateId } from '../utils/generateId'
import { NodeType, WorkflowEdge, WorkflowNode } from '../types/workflow'

const nodeTypes = { workflowNode: WorkflowNodeComponent }
const edgeTypes = { workflowEdge: WorkflowEdgeComponent }

const NODE_TYPE_OPTIONS: { type: NodeType; label: string; color: string }[] = [
  { type: 'NODE0', label: 'NODE0 수신 프로토콜', color: '#3b82f6' },
  { type: 'NODE1', label: 'NODE1 Input DTO',     color: '#8b5cf6' },
  { type: 'NODE2', label: 'NODE2 값 변환',        color: '#f59e0b' },
  { type: 'NODE3', label: 'NODE3 Output DTO',    color: '#10b981' },
  { type: 'NODE4', label: 'NODE4 송신',           color: '#ef4444' },
  { type: 'NODE5', label: 'NODE5 응답 설정',      color: '#06b6d4' },
]

export default function WorkflowPage() {
  const { units, selectedUnitId, fetchUnits, saveUnit } = useWorkflowStore()
  const { openPanel, registerDeleteHandler, registerUpdateHandler } = usePanelStore()
  const { isOpen: historyOpen, openDrawer: openHistory } = useHistoryStore()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [isDirty, setIsDirty] = useState(false)

  // Compute display nodes: NODE4 with no outgoing edge gets isTerminal=true
  const displayNodes = useMemo(() => {
    const sources = new Set((edges as any[]).map((e) => e.source))
    return nodes.map((n: any) => {
      if (n.data?.nodeType === 'NODE4' && !sources.has(n.id)) {
        return { ...n, data: { ...n.data, isTerminal: true } }
      }
      return n
    })
  }, [nodes, edges])

  // NODE5 is mandatory: warn when missing from the current canvas
  const hasNode5 = useMemo(
    () => (nodes as any[]).some((n) => n.data?.nodeType === 'NODE5'),
    [nodes]
  )

  // Add-node dropdown
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false)
  const addNodeMenuRef = useRef<HTMLDivElement>(null)

  // Auth modal for canvas save
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveBy, setSaveBy] = useState('')
  const [savePassword, setSavePassword] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchUnits() }, [])

  useEffect(() => {
    setIsDirty(false)
    const unit = units.find((u) => u.id === selectedUnitId)
    if (!unit) { setNodes([]); setEdges([]); return }
    const { nodes: n, edges: e } = workflowUnitToFlow(unit, {
      onDeleteEdge: handleDeleteEdge,
    })
    setNodes(n)
    setEdges(e)
  }, [selectedUnitId, units])

  // ── Delete node (called from NodeSettingsPanel) ──
  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setIsDirty(true)
  }, [setNodes, setEdges])

  // Register delete handler so NodeSettingsPanel can call it
  useEffect(() => {
    registerDeleteHandler(handleDeleteNode)
  }, [handleDeleteNode, registerDeleteHandler])

  // ── Update node definition from panel (no per-node save; uses global save) ──
  const handleUpdateNode = useCallback((updatedNode: any) => {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== updatedNode.id) return n
      return {
        ...n,
        data: {
          ...n.data,
          definition: updatedNode.node0 ?? updatedNode.node1 ?? updatedNode.node2 ?? updatedNode.node3 ?? updatedNode.node4,
          workflowNode: updatedNode,
        },
      }
    }))
    setIsDirty(true)
  }, [setNodes])

  useEffect(() => {
    registerUpdateHandler(handleUpdateNode)
  }, [handleUpdateNode, registerUpdateHandler])

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
    setIsDirty(true)
  }, [setEdges])

  // Re-attach callbacks whenever they update (so edge data always has fresh refs)
  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: {
          ...(e.data as any),
          onDeleteEdge: handleDeleteEdge,
        },
      }))
    )
  }, [handleDeleteEdge])

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes)
    const meaningfulChange = changes.some(
      (c) => c.type === 'position' && 'dragging' in c && !c.dragging
    )
    if (meaningfulChange) setIsDirty(true)
  }, [onNodesChange])

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes)
    setIsDirty(true)
  }, [onEdgesChange])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge({
          ...connection,
          id: generateId('e'),
          type: 'workflowEdge',
          data: {
            onDeleteEdge: handleDeleteEdge,
          },
        }, eds)
      )
      setIsDirty(true)
    },
    [setEdges, handleDeleteEdge]
  )

  const handleAutoLayout = () => {
    setNodes((ns) => applyDagreLayout(ns, edges))
    setIsDirty(true)
  }

  const onNodeClick = useCallback((_event: React.MouseEvent, node: any) => {
    const unit = units.find((u) => u.id === selectedUnitId)
    if (!unit) return
    // Prefer node.data.workflowNode (kept up-to-date by handleUpdateNode) over units store
    const workflowNode = node.data?.workflowNode ?? unit.nodes.find((n: any) => n.id === node.id)
    if (!workflowNode) return
    // Build live unit: canvas nodes include unsaved panel edits (e.g. NODE1 fields just confirmed),
    // fallback to store for nodes that have never been opened in the panel.
    const savedNodeById = new Map(unit.nodes.map(n => [n.id, n]))
    const liveNodes = (nodes as any[]).map(fn => {
      const wn = fn.data?.workflowNode as WorkflowNode | undefined
      if (wn) return { ...wn, position: fn.position }
      return savedNodeById.get(fn.id) ?? { id: fn.id, nodeType: fn.data?.nodeType ?? 'NODE0', position: fn.position }
    })
    const savedEdgeById = new Map(unit.edges.map(e => [e.id, e]))
    const liveEdges: WorkflowEdge[] = (edges as any[]).map(fe => ({
      id: fe.id,
      sourceNodeId: fe.source,
      targetNodeId: fe.target,
      isDashed: savedEdgeById.get(fe.id)?.isDashed ?? false,
    }))
    openPanel(workflowNode, { ...unit, nodes: liveNodes, edges: liveEdges })
  }, [units, selectedUnitId, openPanel, nodes, edges])

  // ── Add node to canvas ──
  const handleAddNode = useCallback((nodeType: NodeType) => {
    setShowAddNodeMenu(false)
    const id = generateId('n')
    const COLORS: Record<string, string> = {
      NODE0: '#3b82f6', NODE1: '#8b5cf6', NODE2: '#f59e0b', NODE3: '#10b981', NODE4: '#ef4444', NODE5: '#06b6d4',
    }
    const LABELS: Record<string, string> = {
      NODE0: '수신 프로토콜', NODE1: 'Input DTO', NODE2: '값 변환', NODE3: 'Output DTO', NODE4: '송신', NODE5: '응답 설정',
    }
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: 'workflowNode',
        position: { x: 150 + Math.random() * 250, y: 100 + Math.random() * 150 },
        data: {
          nodeType,
          label: LABELS[nodeType] ?? nodeType,
          color: COLORS[nodeType] ?? '#64748b',
          definition: null,
          unitId: selectedUnitId,
        },
      },
    ])
    setIsDirty(true)
  }, [selectedUnitId, setNodes])

  // Close add-node menu on outside click
  useEffect(() => {
    if (!showAddNodeMenu) return
    const handler = (e: MouseEvent) => {
      if (addNodeMenuRef.current && !addNodeMenuRef.current.contains(e.target as Node)) {
        setShowAddNodeMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAddNodeMenu])

  // ── Save canvas changes ──
  const handleSaveCanvas = async () => {
    if (!saveBy || !savePassword) { setSaveError('이름과 비밀번호를 입력해 주세요.'); return }
    const unit = units.find((u) => u.id === selectedUnitId)
    if (!unit) return
    setSaving(true)
    setSaveError(null)
    try {
      const updatedUnit = flowToWorkflowUnit(unit, nodes, edges)

      // Validate NODE5 presence (mandatory)
      if (!updatedUnit.nodes.some((n) => n.nodeType === 'NODE5')) {
        setSaveError('NODE5 (응답 설정 노드)가 없습니다. + 노드 추가에서 NODE5를 추가해 주세요.')
        setSaving(false)
        return
      }

      const reservedPath = updatedUnit.nodes.find(
        (n) => n.node0?.protocol === 'REST_SERVER' && n.node0.path?.startsWith('/synapse/')
      )
      if (reservedPath) {
        setSaveError('/synapse/ 로 시작하는 경로는 내부 예약 경로입니다. Node0 endpoint를 변경해 주세요.')
        setSaving(false)
        return
      }
      await saveUnit(updatedUnit, saveBy, savePassword)
      setIsDirty(false)
      setShowSaveModal(false)
      setSaveBy('')
      setSavePassword('')
    } catch (e: any) {
      setSaveError(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full">
      <WorkflowUnitList />

      <div className="flex-1 relative flex flex-col">
        {/* NODE5 missing warning */}
        {selectedUnitId && !hasNode5 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-900/90 border border-amber-600/70 text-xs text-amber-200 shadow-lg pointer-events-none">
            <span>⚠</span>
            <span>
              <strong>NODE5 (응답 설정)</strong>가 없습니다. 저장하려면{' '}
              <strong>+ 노드 추가 → NODE5</strong>를 추가해야 합니다.
            </span>
          </div>
        )}

        {/* Canvas toolbar */}
        {selectedUnitId && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            {isDirty && (
              <span className="text-xs text-amber-400 bg-amber-900/40 border border-amber-700/50 px-2 py-1 rounded">
                미저장 변경사항
              </span>
            )}

            {/* Add Node dropdown */}
            <div className="relative" ref={addNodeMenuRef}>
              <button
                onClick={() => setShowAddNodeMenu((v) => !v)}
                className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600"
              >
                + 노드 추가
              </button>
              {showAddNodeMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-slate-800 border border-slate-600 rounded shadow-xl z-20 py-1">
                  {NODE_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => handleAddNode(opt.type)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white text-left"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: opt.color }} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleAutoLayout}
              title="노드 자동 정렬"
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600"
            >
              정렬
            </button>

            <button
              onClick={() => { setShowSaveModal(true); setSaveError(null) }}
              className={`px-3 py-1.5 text-xs rounded text-white font-medium shadow ${
                isDirty
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-slate-600 hover:bg-slate-500 border border-slate-500'
              }`}
            >
              저장
            </button>
            <button
              onClick={openHistory}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600"
            >
              히스토리
            </button>
          </div>
        )}

        {selectedUnitId ? (
          <ReactFlow
            nodes={displayNodes as any}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            className="bg-slate-900 flex-1"
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background variant={BackgroundVariant.Dots} color="#334155" gap={20} />
            <Controls className="bg-slate-800 border-slate-600" />
            <MiniMap className="bg-slate-800" nodeColor="#475569" />
          </ReactFlow>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <div className="text-4xl mb-3">&#9881;&#65039;</div>
              <div className="text-lg">왼쪽에서 워크플로우 단위를 선택하거나 새로 만드세요</div>
              <button
                onClick={openHistory}
                className="mt-4 px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600"
              >
                히스토리 보기
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Node settings panel (right slide-in) */}
      <NodeSettingsPanel />

      {/* History drawer (right slide-in) */}
      <HistoryDrawer />

      {/* Canvas save auth modal */}
      {showSaveModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowSaveModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="w-80 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto p-5 space-y-4">
              <div className="text-sm font-semibold text-white">워크플로우 저장</div>
              <div className="text-xs text-slate-400">
                노드 설정, 추가/삭제, 위치, 엣지 연결 등 모든 변경사항을 저장합니다.
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  value={saveBy}
                  onChange={(e) => setSaveBy(e.target.value)}
                  placeholder="수정자 이름"
                  autoFocus
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  value={savePassword}
                  onChange={(e) => setSavePassword(e.target.value)}
                  placeholder="비밀번호"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCanvas() }}
                  className="w-full px-3 py-2 text-sm rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              {saveError && <div className="text-xs text-red-400">{saveError}</div>}
              <div className="flex gap-2">
                <button onClick={() => setShowSaveModal(false)} className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white">취소</button>
                <button
                  onClick={handleSaveCanvas}
                  disabled={saving}
                  className="flex-1 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
