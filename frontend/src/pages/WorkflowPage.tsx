import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import AiChatPanel from '../components/llm/AiChatPanel'
import { useAuthStore } from '../store/authStore'
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
  Node as FlowNode,
  Edge as FlowEdge,
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
import SimTestDrawer, { UnitSimulationResult, type Node4NodeInfo } from '../components/simulator/SimTestDrawer'
import SimTraceTimeline from '../components/simulator/SimTraceTimeline'
import SimContext from '../context/SimContext'
import { generateId } from '../utils/generateId'
import { NodeType, WorkflowCondition, WorkflowEdge, WorkflowNode } from '../types/workflow'

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
  const { openPanel, closePanel, registerDeleteHandler, registerUpdateHandler, registerUpdateConditionHandler } = usePanelStore()
  const { isOpen: historyOpen, openDrawer: openHistory } = useHistoryStore()
  const { canWrite } = useAuthStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [isDirty, setIsDirty] = useState(false)
  const [pendingConditions, setPendingConditions] = useState<Record<string, WorkflowCondition>>({})

  const displayNodes = nodes

  // Add-node dropdown
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false)
  const addNodeMenuRef = useRef<HTMLDivElement>(null)

  // Canvas save modal
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ── Sim mode ──────────────────────────────────────────────────────────────────
  const [simMode, setSimMode] = useState(false)
  const [simResult, setSimResult] = useState<UnitSimulationResult | null>(null)
  const [simActiveNodeId, setSimActiveNodeId] = useState<string | null>(null)
  const [drawerHeight, setDrawerHeight] = useState(210)

  // Build trace map from sim result
  const simTraceMap = useMemo(() => {
    if (!simResult) return {}
    return Object.fromEntries(simResult.nodeTraces.map(t => [t.nodeId, t]))
  }, [simResult])

  // Build edge snapshot map: edgeId → source node's outputSnapshot
  const simEdgeSnapshotMap = useMemo(() => {
    if (!simResult) return {}
    const traceByNodeId = Object.fromEntries(simResult.nodeTraces.map(t => [t.nodeId, t]))
    const result: Record<string, Record<string, unknown> | null> = {}
    for (const edge of edges) {
      const sourceTrace = traceByNodeId[(edge as any).source]
      if (sourceTrace?.outputSnapshot) {
        result[edge.id] = sourceTrace.outputSnapshot as Record<string, unknown>
      }
    }
    return result
  }, [simResult, edges])

  // NODE0 info of the currently selected unit — passed to SimTestDrawer
  const node0Info = useMemo(() => {
    const unit = units.find(u => u.id === selectedUnitId)
    const node0 = unit?.nodes.find(n => n.nodeType === 'NODE0')?.node0
    if (!node0) return undefined
    return { protocol: node0.protocol as string }
  }, [units, selectedUnitId])

  // NODE4 nodes of the currently selected unit — passed to SimTestDrawer
  const node4Nodes = useMemo((): Node4NodeInfo[] => {
    const unit = units.find(u => u.id === selectedUnitId)
    if (!unit) return []
    return unit.nodes
      .filter(n => n.nodeType === 'NODE4' && n.node4)
      .map(n => {
        const isSessionProtocol = n.node4!.protocol === 'WEBSOCKET_SERVER' || n.node4!.protocol === 'TCP_SERVER'
        const replyToSelf = isSessionProtocol ? n.node4!.targetPath == null : undefined
        const label = isSessionProtocol
          ? `${n.node4!.protocol} → ${replyToSelf ? '현재 유닛' : (n.node4!.targetPath ?? '?')}`
          : `${n.node4!.protocol} → ${n.node4!.targetHost ?? '?'}:${n.node4!.targetPort ?? '?'}`
        return {
          nodeId: n.id,
          label,
          protocol: n.node4!.protocol,
          currentHost: n.node4!.targetHost,
          currentPort: n.node4!.targetPort,
          replyToSelf,
          currentTargetIp: isSessionProtocol ? (n.node4!.targetPath ?? undefined) : undefined,
        }
      })
  }, [units, selectedUnitId])

  const simContextValue = useMemo(() => ({
    traceMap: simTraceMap,
    edgeSnapshotMap: simEdgeSnapshotMap,
    activeNodeId: simActiveNodeId,
  }), [simTraceMap, simEdgeSnapshotMap, simActiveNodeId])

  function handleSimResult(result: UnitSimulationResult | null) {
    setSimResult(result)
    setSimActiveNodeId(null)
  }

  function closeSimMode() {
    setSimMode(false)
    setSimResult(null)
    setSimActiveNodeId(null)
  }

  // ── Workflow load ──────────────────────────────────────────────────────────────
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
    // Clear sim state when switching units
    setSimResult(null)
    setSimActiveNodeId(null)
  }, [selectedUnitId, units])

  // ── Node/edge handlers ────────────────────────────────────────────────────────
  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setIsDirty(true)
  }, [setNodes, setEdges])

  useEffect(() => {
    registerDeleteHandler(handleDeleteNode)
  }, [handleDeleteNode, registerDeleteHandler])

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

  const handleUpdateCondition = useCallback((condition: WorkflowCondition) => {
    if (!selectedUnitId) return
    setPendingConditions((prev) => ({ ...prev, [selectedUnitId]: condition }))
    setIsDirty(true)
  }, [selectedUnitId])

  useEffect(() => {
    registerUpdateConditionHandler(handleUpdateCondition)
  }, [handleUpdateCondition, registerUpdateConditionHandler])

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
    setIsDirty(true)
  }, [setEdges])

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
    // In sim mode, clicking a node with a trace highlights it in the timeline
    if (simMode && simTraceMap[node.id]) {
      setSimActiveNodeId(node.id)
      return
    }

    const unit = units.find((u) => u.id === selectedUnitId)
    if (!unit) return
    const workflowNode: WorkflowNode = node.data?.workflowNode
      ?? unit.nodes.find((n: any) => n.id === node.id)
      ?? { id: node.id, nodeType: node.data?.nodeType as NodeType, position: node.position }
    if (!workflowNode) return
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
    const liveCondition = pendingConditions[unit.id] ?? unit.condition
    openPanel(workflowNode, { ...unit, condition: liveCondition, nodes: liveNodes, edges: liveEdges })
  }, [units, selectedUnitId, openPanel, nodes, edges, simMode, simTraceMap])

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

  // ── Canvas save ───────────────────────────────────────────────────────────────
  const handleSaveCanvas = async () => {
    const unit = units.find((u) => u.id === selectedUnitId)
    if (!unit) return
    setSaving(true)
    setSaveError(null)
    try {
      const pendingCondition = selectedUnitId ? pendingConditions[selectedUnitId] : undefined
      const baseUnit = pendingCondition ? { ...unit, condition: pendingCondition } : unit
      const updatedUnit = flowToWorkflowUnit(baseUnit, nodes, edges)

      const reservedPath = updatedUnit.nodes.find(
        (n) => n.node0?.protocol === 'REST_SERVER' && n.node0.path?.startsWith('/synapse/')
      )
      if (reservedPath) {
        setSaveError('/synapse/ 로 시작하는 경로는 내부 예약 경로입니다. Node0 endpoint를 변경해 주세요.')
        setSaving(false)
        return
      }
      await saveUnit(updatedUnit)
      setIsDirty(false)
      setShowSaveModal(false)
      if (selectedUnitId) setPendingConditions((prev) => { const next = { ...prev }; delete next[selectedUnitId!]; return next })
    } catch (e: any) {
      setSaveError(e.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full">
      <WorkflowUnitList />

      <div className="flex-1 relative flex flex-col min-w-0">
        {/* Canvas toolbar */}
        {selectedUnitId && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            {isDirty && (
              <span className="text-xs text-amber-400 bg-amber-900/40 border border-amber-700/50 px-2 py-1 rounded">
                미저장 변경사항
              </span>
            )}

            {/* Test mode toggle — admin only */}
            {canWrite() && (
              <button
                onClick={() => {
                  if (simMode) {
                    closeSimMode()
                  } else {
                    closePanel()
                    setSimMode(true)
                  }
                }}
                className={`px-3 py-1.5 text-xs rounded font-medium border transition-colors ${
                  simMode
                    ? 'bg-green-700 hover:bg-green-800 text-white border-green-600'
                    : 'bg-slate-700 hover:bg-slate-600 text-white border-slate-600'
                }`}
              >
                {simMode ? '▶ 테스트 중' : '▶ 테스트'}
              </button>
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

            {canWrite() && (
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
            )}
            <button
              onClick={openHistory}
              className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600"
            >
              히스토리
            </button>
          </div>
        )}

        {selectedUnitId ? (
          <SimContext.Provider value={simContextValue}>
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
              <Controls className="bg-slate-800 border-slate-600" showInteractiveButton={false} />
              <MiniMap className="bg-slate-800" nodeColor="#475569" />
            </ReactFlow>
          </SimContext.Provider>
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

        {/* Test mode bottom drawer */}
        {simMode && selectedUnitId && (
          <SimTestDrawer
            unitId={selectedUnitId}
            node4Nodes={node4Nodes}
            node0Info={node0Info}
            onResult={handleSimResult}
            onClose={closeSimMode}
            onHeightChange={setDrawerHeight}
          />
        )}
      </div>

      {/* Trace timeline — right panel, shown after execution */}
      {simResult && (
        <SimTraceTimeline
          traces={simResult.nodeTraces}
          success={simResult.success}
          durationMs={simResult.durationMs}
          errorMessage={simResult.errorMessage}
          response={simResult.response}
          activeNodeId={simActiveNodeId}
          onNodeClick={setSimActiveNodeId}
          onClose={() => setSimResult(null)}
        />
      )}

      {/* Node settings panel (right slide-in overlay) */}
      <NodeSettingsPanel />

      {/* History drawer (right slide-in) */}
      <HistoryDrawer />

      {/* AI 도우미 플로팅 버튼 + 채팅 패널 */}
      {aiChatOpen && <AiChatPanel onClose={() => setAiChatOpen(false)} />}
      <button
        onClick={() => setAiChatOpen((v) => !v)}
        title="AI 도우미"
        style={{ bottom: simMode && selectedUnitId ? drawerHeight + 12 : 16 }}
        className={`fixed right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg text-sm font-medium transition-[bottom,colors] ${
          aiChatOpen ? 'bg-violet-700 text-white' : 'bg-slate-800 border border-slate-600 text-violet-400 hover:bg-slate-700'
        }`}
      >
        <span>✦</span>
        <span>AI 도우미</span>
      </button>

      {/* Canvas save modal */}
      {showSaveModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowSaveModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="w-72 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto p-5 space-y-4">
              <div className="text-sm font-semibold text-white">워크플로우 저장</div>
              <div className="text-xs text-slate-400">
                노드 설정, 추가/삭제, 위치, 엣지 연결 등 모든 변경사항을 저장합니다.
              </div>
              {saveError && <div className="text-xs text-red-400">{saveError}</div>}
              <div className="flex gap-2">
                <button onClick={() => setShowSaveModal(false)} className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white">취소</button>
                <button
                  onClick={handleSaveCanvas}
                  disabled={saving}
                  autoFocus
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
