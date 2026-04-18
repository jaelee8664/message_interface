import { useState, useEffect, useRef } from 'react'
import PipelineTraceView from '../components/simulator/PipelineTraceView'
import type { SimulationNodeTrace } from '../components/simulator/PipelineTraceView'
import PipelineMiniMap from '../components/simulator/PipelineMiniMap'
import type { RawNode, RawEdge } from '../components/simulator/PipelineMiniMap'
import { authFetch } from '../utils/authFetch'
import { useAuthStore } from '../store/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowUnitSummary {
  id: string
  name: string
}

interface UnitSimulationResult {
  success: boolean
  nodeTraces: SimulationNodeTrace[]
  response: string | null
  httpStatus: number
  errorMessage: string | null
  durationMs: number
}

interface StepAssertion {
  fieldPath: string
  operator: 'equals' | 'contains' | 'exists'
  expectedValue: string
}

interface AssertionResult extends StepAssertion {
  passed: boolean
  actualValue: string
}

interface Node4Override {
  host: string
  port: string  // kept as string for input binding; converted on send
  ip: string    // WEBSOCKET_SERVER / TCP_SERVER 대상 IP 오버라이드
}

interface SimulationStep {
  order: number
  name: string
  unitId: string
  message: string
  format: string
  endpoint: string
  protocol: string | null
  metadata: Record<string, string>
  node4Overrides: Record<string, Node4Override>  // nodeId → override
  delayAfterMs: number
  useResponseFromPrevStep: boolean
  assertions: StepAssertion[]
}

interface Node4NodeInfo {
  nodeId: string
  label: string
  protocol: string
  currentHost?: string
  currentPort?: number
}

interface Node0Info {
  protocol: string
  endpoint: string | null
  format: string
}

interface SimulationScenario {
  id: string
  name: string
  description: string
  steps: SimulationStep[]
  stopOnFailure: boolean
  createdAt: string
  updatedAt: string
}

interface EnhancedStepResult {
  stepOrder: number
  stepName: string
  unitId: string
  result: UnitSimulationResult
  assertionResults: AssertionResult[]
  overallSuccess: boolean
}

type StepRunStatus = 'idle' | 'pending' | 'running' | 'done'

function emptyStep(order: number): SimulationStep {
  return {
    order,
    name: `Step ${order}`,
    unitId: '',
    message: '{}',
    format: 'JSON',
    endpoint: '',
    protocol: null,
    metadata: {},
    node4Overrides: {},
    delayAfterMs: 0,
    useResponseFromPrevStep: false,
    assertions: [],
  }
}

function emptyScenario(): Omit<SimulationScenario, 'id' | 'createdAt' | 'updatedAt'> {
  return { name: '', description: '', steps: [emptyStep(1)], stopOnFailure: false }
}

// ── Log Play types ────────────────────────────────────────────────────────────

interface LogPlayEntry {
  traceId: string
  workflowUnitId: string
  workflowUnitName: string
  timestamp: string
  message: string
  format: string
}

interface LogPlayRunResultItem {
  traceId: string
  workflowUnitId: string
  workflowUnitName: string
  result: UnitSimulationResult
}

interface ExtendedNode4Info {
  nodeId: string
  unitId: string
  label: string
  protocol: string
  currentHost?: string
  currentPort?: number
  replyToSelf?: boolean
  currentTargetIp?: string
}

function supportsHostPortOverride(protocol: string | null | undefined): boolean {
  if (!protocol) return false
  return protocol === 'REST_CLIENT' || protocol === 'WEBSOCKET_CLIENT' || protocol === 'TCP_CLIENT'
}

function supportsTargetIpOverrideExt(n: ExtendedNode4Info): boolean {
  return (n.protocol === 'WEBSOCKET_SERVER' || n.protocol === 'TCP_SERVER') && n.replyToSelf === false
}

function localDatetimeAt(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function localDatetimeNow(): string { return localDatetimeAt(new Date()) }
function localDatetimeMinsAgo(mins: number): string { return localDatetimeAt(new Date(Date.now() - mins * 60_000)) }

// ── Assertion logic ───────────────────────────────────────────────────────────

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj == null || path === '') return obj
  return path.split('.').reduce((cur: unknown, key) => {
    if (cur == null || typeof cur !== 'object') return undefined
    return (cur as Record<string, unknown>)[key]
  }, obj)
}

function evaluateAssertions(assertions: StepAssertion[], result: UnitSimulationResult): AssertionResult[] {
  // Prefer parsed response JSON; fall back to last node's outputSnapshot
  let data: unknown = null
  if (result.response) {
    try { data = JSON.parse(result.response) } catch { data = result.response }
  }
  if (data == null) {
    const lastOk = [...result.nodeTraces].reverse().find(t => t.status === 'SUCCESS' && t.outputSnapshot)
    data = lastOk?.outputSnapshot ?? null
  }

  return assertions.map(a => {
    const raw = getNestedValue(data, a.fieldPath)
    const actual = raw == null ? 'undefined' : String(raw)
    let passed = false
    switch (a.operator) {
      case 'exists':   passed = raw != null; break
      case 'equals':   passed = actual === a.expectedValue; break
      case 'contains': passed = actual.includes(a.expectedValue); break
    }
    return { ...a, passed, actualValue: actual }
  })
}

// ── Step executor (single) ────────────────────────────────────────────────────

async function executeStep(step: SimulationStep, message: string): Promise<UnitSimulationResult> {
  try {
    const node4Overrides = Object.fromEntries(
      Object.entries(step.node4Overrides)
        .filter(([_, v]) => v.host.trim() || v.port.trim() || v.ip.trim())
        .map(([nodeId, v]) => [
          nodeId,
          {
            host: v.host.trim() || undefined,
            port: v.port.trim() ? parseInt(v.port) : undefined,
            targetIp: v.ip.trim() || undefined,
          },
        ])
    )
    const res = await authFetch('/synapse/simulator/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId: step.unitId,
        message,
        format: step.format,
        endpoint: step.endpoint || undefined,
        protocol: step.protocol,
        node4Overrides,
      }),
    })
    const json = await res.json()
    return json.data as UnitSimulationResult
  } catch (e) {
    return { success: false, nodeTraces: [], response: null, httpStatus: 0, errorMessage: String(e), durationMs: 0 }
  }
}

// ── Assertion Editor ──────────────────────────────────────────────────────────

function AssertionEditor({
  assertions,
  onChange,
}: {
  assertions: StepAssertion[]
  onChange: (a: StepAssertion[]) => void
}) {
  function add() {
    onChange([...assertions, { fieldPath: '', operator: 'equals', expectedValue: '' }])
  }
  function update(i: number, patch: Partial<StepAssertion>) {
    const next = [...assertions]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">어설션</span>
        <button
          className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded border border-blue-800 hover:border-blue-600 transition-colors"
          onClick={add}
        >
          + 추가
        </button>
      </div>
      {assertions.length === 0 && (
        <div className="text-xs text-slate-600 italic">어설션 없음 — 파이프라인 성공 여부만 판단</div>
      )}
      {assertions.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white font-mono"
            placeholder="필드 경로 (예: data.status)"
            value={a.fieldPath}
            onChange={e => update(i, { fieldPath: e.target.value })}
          />
          <select
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
            value={a.operator}
            onChange={e => update(i, { operator: e.target.value as StepAssertion['operator'] })}
          >
            <option value="equals">==</option>
            <option value="contains">포함</option>
            <option value="exists">존재</option>
          </select>
          {a.operator !== 'exists' && (
            <input
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
              placeholder="기댓값"
              value={a.expectedValue}
              onChange={e => update(i, { expectedValue: e.target.value })}
            />
          )}
          <button
            className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors"
            onClick={() => remove(i)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Step Editor ────────────────────────────────────────────────────────────────

function StepEditor({
  step,
  isFirst,
  units,
  onChange,
  onDelete,
}: {
  step: SimulationStep
  isFirst: boolean
  units: WorkflowUnitSummary[]
  onChange: (s: SimulationStep) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(true)
  const [node4Nodes, setNode4Nodes] = useState<ExtendedNode4Info[]>([])
  const [node0Info, setNode0Info] = useState<Node0Info | null>(null)
  const [unitNodes, setUnitNodes] = useState<RawNode[]>([])
  const [unitEdges, setUnitEdges] = useState<RawEdge[]>([])

  // Fetch unit info whenever the selected unit changes
  useEffect(() => {
    if (!step.unitId) {
      setNode4Nodes([]); setNode0Info(null)
      setUnitNodes([]); setUnitEdges([])
      return
    }
    authFetch(`/synapse/workflow/units/${step.unitId}`)
      .then(r => r.json())
      .then(json => {
        const nodes: RawNode[] = json.data?.nodes ?? []
        const edges: RawEdge[] = json.data?.edges ?? []
        setUnitNodes(nodes)
        setUnitEdges(edges)

        // NODE0: protocol + endpoint
        const node0 = nodes.find(n => n.nodeType === 'NODE0')
        // NODE1: format
        const node1 = nodes.find(n => n.nodeType === 'NODE1')
        const info: Node0Info = {
          protocol: node0?.node0?.protocol ?? 'REST_SERVER',
          endpoint: node0?.node0?.path ?? null,
          format: (node1 as any)?.node1?.messageFormat ?? 'JSON',
        }
        setNode0Info(info)
        onChange({
          ...step,
          protocol: info.protocol,
          endpoint: info.endpoint ?? '',
          format: info.format,
        })

        // NODE4 list — replyToSelf은 targetPath==null인 세션 프로토콜로 판단
        const n4: ExtendedNode4Info[] = nodes
          .filter(n => n.nodeType === 'NODE4' && n.node4)
          .map(n => {
            const isSession = n.node4!.protocol === 'WEBSOCKET_SERVER' || n.node4!.protocol === 'TCP_SERVER'
            const replyToSelf = isSession ? n.node4!.targetPath == null : undefined
            const label = isSession
              ? `${n.node4!.protocol} → ${replyToSelf ? '현재 유닛' : (n.node4!.targetPath ?? '?')}`
              : `${n.node4!.protocol} → ${n.node4!.targetHost ?? '?'}:${n.node4!.targetPort ?? '?'}`
            return {
              nodeId: n.id,
              unitId: step.unitId,
              label,
              protocol: n.node4!.protocol,
              currentHost: n.node4!.targetHost,
              currentPort: n.node4!.targetPort,
              replyToSelf,
              currentTargetIp: isSession ? (n.node4!.targetPath ?? undefined) : undefined,
            }
          })
        setNode4Nodes(n4)
      })
      .catch(() => {
        setNode4Nodes([]); setNode0Info(null)
        setUnitNodes([]); setUnitEdges([])
      })
  }, [step.unitId])

  function field<K extends keyof SimulationStep>(key: K, value: SimulationStep[K]) {
    onChange({ ...step, [key]: value })
  }

  function setOverride(nodeId: string, f: 'host' | 'port' | 'ip', value: string) {
    field('node4Overrides', {
      ...step.node4Overrides,
      [nodeId]: { ...(step.node4Overrides[nodeId] ?? { host: '', port: '', ip: '' }), [f]: value },
    })
  }

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-slate-700 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-bold text-slate-300 w-12 shrink-0">Step {step.order}</span>
        <input
          className="flex-1 bg-transparent border-none outline-none text-sm text-white"
          value={step.name}
          onChange={e => { e.stopPropagation(); field('name', e.target.value) }}
          onClick={e => e.stopPropagation()}
          placeholder="단계 이름"
        />
        {!isFirst && step.useResponseFromPrevStep && (
          <span className="text-xs text-cyan-400 bg-cyan-900/40 border border-cyan-700/50 px-1.5 py-0.5 rounded shrink-0">
            체이닝
          </span>
        )}
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
        <button
          className="text-red-400 hover:text-red-300 text-xs px-1"
          onClick={e => { e.stopPropagation(); onDelete() }}
        >✕</button>
      </div>

      {open && (
        <div className="p-3 space-y-2.5 bg-slate-800">
          {/* Basic fields */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">유닛</label>
              <select
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
                value={step.unitId}
                onChange={e => field('unitId', e.target.value)}
              >
                <option value="">선택...</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {/* Unit info (read-only, derived from NODE0/NODE1) */}
          {step.unitId && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">파이프라인 정보</label>
              {node0Info ? (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-cyan-300 font-mono">
                    {node0Info.protocol}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-purple-300">
                    {node0Info.format}
                  </span>
                  {node0Info.endpoint && (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-slate-300 font-mono">
                      {node0Info.endpoint}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic">불러오는 중...</div>
              )}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1">딜레이 (ms)</label>
              <input
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
                placeholder="0"
                type="number"
                value={step.delayAfterMs}
                onChange={e => field('delayAfterMs', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Pipeline tree with inline CLIENT NODE4 host/port overrides */}
          {unitNodes.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                파이프라인
                {node4Nodes.some(n => !supportsTargetIpOverrideExt(n)) && (
                  <span className="ml-1.5 text-slate-500">(NODE4 클라이언트 행에서 주소 오버라이드)</span>
                )}
              </label>
              <PipelineMiniMap
                nodes={unitNodes}
                edges={unitEdges}
                overrides={step.node4Overrides}
                onOverrideChange={(nodeId, f, value) => setOverride(nodeId, f, value)}
              />
            </div>
          )}

          {/* SERVER NODE4 IP overrides — WEBSOCKET_SERVER / TCP_SERVER with replyToSelf=false */}
          {node4Nodes.some(n => supportsTargetIpOverrideExt(n)) && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">대상 클라이언트 IP 오버라이드</label>
              <p className="text-[10px] text-slate-500 mb-1.5">비워두면 워크플로우에 설정된 IP로 전송됩니다.</p>
              <div className="space-y-1.5">
                {node4Nodes.filter(n => supportsTargetIpOverrideExt(n)).map(n => {
                  const ov = step.node4Overrides[n.nodeId] ?? { host: '', port: '', ip: '' }
                  return (
                    <div key={n.nodeId}>
                      <div className="text-[10px] text-slate-500 mb-0.5">{n.label}</div>
                      <input
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white font-mono"
                        placeholder={n.currentTargetIp ?? '예: 192.168.0.10'}
                        value={ov.ip}
                        onChange={e => setOverride(n.nodeId, 'ip', e.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="border-t border-slate-700 pt-2.5 space-y-2">
            {/* Chaining toggle */}
            {!isFirst && (
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  className="rounded border-slate-500 accent-cyan-500"
                  checked={step.useResponseFromPrevStep}
                  onChange={e => field('useResponseFromPrevStep', e.target.checked)}
                />
                <span className="text-xs text-slate-300">이전 단계 응답을 메시지로 사용</span>
                <span className="text-xs text-slate-500">(체이닝)</span>
              </label>
            )}

            {/* Message */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">메시지</label>
              {step.useResponseFromPrevStep && !isFirst ? (
                <div className="w-full h-16 bg-slate-900 border border-slate-600 border-dashed rounded px-2 py-2 text-xs text-slate-500 italic flex items-center">
                  이전 단계 응답이 자동으로 주입됩니다
                </div>
              ) : (
                <textarea
                  className="w-full h-16 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white font-mono resize-none"
                  value={step.message}
                  onChange={e => field('message', e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>

            {/* Assertions */}
            <AssertionEditor
              assertions={step.assertions}
              onChange={v => field('assertions', v)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step Result Card ───────────────────────────────────────────────────────────

function AssertionResultRow({ ar }: { ar: AssertionResult }) {
  return (
    <div className={`flex items-baseline gap-2 text-xs ${ar.passed ? 'text-green-300' : 'text-red-300'}`}>
      <span className="shrink-0">{ar.passed ? '✓' : '✗'}</span>
      <span className="font-mono text-slate-300">{ar.fieldPath}</span>
      <span className="text-slate-500">
        {ar.operator === 'equals' ? '==' : ar.operator === 'contains' ? '포함' : '존재'}
      </span>
      {ar.operator !== 'exists' && (
        <span className="font-mono">"{ar.expectedValue}"</span>
      )}
      {!ar.passed && (
        <span className="text-slate-500 ml-1">
          (실제: <span className="font-mono text-slate-400">"{ar.actualValue}"</span>)
        </span>
      )}
    </div>
  )
}

function StepResultCard({
  stepResult,
  status,
}: {
  stepResult?: EnhancedStepResult
  status: StepRunStatus
  order: number
  name: string
}) {
  const [openTrace, setOpenTrace] = useState(false)

  useEffect(() => {
    if (stepResult != null && !stepResult.overallSuccess) {
      setOpenTrace(true)
    }
  }, [stepResult])

  if (status === 'pending') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-500 text-sm">
        <span className="w-3 h-3 rounded-full border border-slate-600 shrink-0" />
        <span>대기 중...</span>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 border border-blue-700/50 text-blue-300 text-sm">
        <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse shrink-0" />
        <span>실행 중...</span>
      </div>
    )
  }

  if (!stepResult) return null

  const { result, assertionResults, overallSuccess } = stepResult
  const hasAssertions = assertionResults.length > 0
  const failedAssertions = assertionResults.filter(a => !a.passed)

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      {/* Summary header */}
      <div
        className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
          overallSuccess ? 'bg-green-900/25' : 'bg-red-900/25'
        } hover:brightness-110`}
        onClick={() => setOpenTrace(o => !o)}
      >
        <span className={`text-sm font-medium ${overallSuccess ? 'text-green-300' : 'text-red-300'}`}>
          {overallSuccess ? '✅' : '❌'}
        </span>
        <span className="text-slate-300 text-sm flex-1 truncate">
          {stepResult.stepName || stepResult.unitId}
        </span>
        {hasAssertions && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            failedAssertions.length === 0
              ? 'bg-green-900/40 text-green-400 border border-green-700/50'
              : 'bg-red-900/40 text-red-400 border border-red-700/50'
          }`}>
            어설션 {assertionResults.length - failedAssertions.length}/{assertionResults.length}
          </span>
        )}
        <span className="text-slate-500 text-xs">{result.durationMs}ms</span>
        <span className="text-slate-500 text-xs">{openTrace ? '▲' : '▼'}</span>
      </div>

      {openTrace && (
        <div className="p-3 bg-slate-800 space-y-3">
          {/* Assertion results */}
          {hasAssertions && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400 font-medium mb-1.5">어설션 결과</div>
              {assertionResults.map((ar, i) => <AssertionResultRow key={i} ar={ar} />)}
            </div>
          )}

          {/* Pipeline trace */}
          <PipelineTraceView
            traces={result.nodeTraces}
            success={result.success}
            response={result.response}
            errorMessage={result.errorMessage}
            durationMs={result.durationMs}
          />
        </div>
      )}
    </div>
  )
}

// ── Scenario Tab ───────────────────────────────────────────────────────────────

function ScenarioTab({ units }: { units: WorkflowUnitSummary[] }) {
  const { canWrite } = useAuthStore()
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Omit<SimulationScenario, 'id' | 'createdAt' | 'updatedAt'>>(emptyScenario())
  const [scenarioCreatedAt, setScenarioCreatedAt] = useState<string>('')
  const [isNew, setIsNew] = useState(true)
  const [saving, setSaving] = useState(false)

  // Run state
  const [running, setRunning] = useState(false)
  const [stepStatuses, setStepStatuses] = useState<Record<number, StepRunStatus>>({})
  const [stepResults, setStepResults] = useState<EnhancedStepResult[]>([])
  const abortRef = useRef(false)

  useEffect(() => { fetchScenarios() }, [])

  async function fetchScenarios() {
    const res = await authFetch('/synapse/simulator/scenarios')
    const json = await res.json()
    setScenarios(json.data ?? [])
  }

  function selectScenario(s: SimulationScenario) {
    setSelectedId(s.id)
    setScenarioCreatedAt(s.createdAt as unknown as string)
    setEditing({ name: s.name, description: s.description, steps: s.steps, stopOnFailure: s.stopOnFailure ?? false })
    setIsNew(false)
    clearRunState()
  }

  function newScenario() {
    setSelectedId(null)
    setScenarioCreatedAt('')
    setEditing(emptyScenario())
    setIsNew(true)
    clearRunState()
  }

  function clearRunState() {
    setStepStatuses({})
    setStepResults([])
  }

  async function save() {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const payload = isNew
        ? { id: '', ...editing, createdAt: now, updatedAt: now }
        : { id: selectedId!, ...editing, createdAt: scenarioCreatedAt || now, updatedAt: now }
      const res = await authFetch('/synapse/simulator/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      const saved: SimulationScenario = json.data
      setSelectedId(saved.id)
      setScenarioCreatedAt(saved.createdAt as unknown as string)
      setIsNew(false)
      await fetchScenarios()
    } finally {
      setSaving(false)
    }
  }

  async function deleteScenario() {
    if (!selectedId || !confirm('이 시나리오를 삭제하시겠습니까?')) return
    await authFetch(`/synapse/simulator/scenarios/${selectedId}`, { method: 'DELETE' })
    newScenario()
    await fetchScenarios()
  }

  // ── Sequential client-side execution ────────────────────────────────────────
  async function run() {
    const sorted = [...editing.steps].sort((a, b) => a.order - b.order)
    if (sorted.length === 0) return

    setRunning(true)
    abortRef.current = false
    setStepResults([])

    // Initialize all steps as pending
    setStepStatuses(Object.fromEntries(sorted.map(s => [s.order, 'pending' as StepRunStatus])))

    let prevResponse: string | null = null

    for (const step of sorted) {
      if (abortRef.current) break

      // Mark this step running
      setStepStatuses(prev => ({ ...prev, [step.order]: 'running' }))

      const message = (step.useResponseFromPrevStep && prevResponse != null)
        ? prevResponse
        : step.message

      const result = await executeStep(step, message)
      const assertionResults = evaluateAssertions(step.assertions, result)
      const overallSuccess = result.success && assertionResults.every(a => a.passed)

      const enhanced: EnhancedStepResult = {
        stepOrder: step.order,
        stepName: step.name,
        unitId: step.unitId,
        result,
        assertionResults,
        overallSuccess,
      }

      setStepResults(prev => [...prev, enhanced])
      setStepStatuses(prev => ({ ...prev, [step.order]: 'done' }))

      prevResponse = result.response

      if (step.delayAfterMs > 0) {
        await new Promise(r => setTimeout(r, step.delayAfterMs))
      }

      if (editing.stopOnFailure && !overallSuccess) break
    }

    setRunning(false)
  }

  function stopRun() {
    abortRef.current = true
  }

  function addStep() {
    const nextOrder = (editing.steps.length > 0 ? Math.max(...editing.steps.map(s => s.order)) : 0) + 1
    setEditing(e => ({ ...e, steps: [...e.steps, emptyStep(nextOrder)] }))
  }

  function updateStep(index: number, step: SimulationStep) {
    setEditing(e => { const steps = [...e.steps]; steps[index] = step; return { ...e, steps } })
  }

  function deleteStep(index: number) {
    setEditing(e => ({ ...e, steps: e.steps.filter((_, i) => i !== index) }))
  }

  const sorted = [...editing.steps].sort((a, b) => a.order - b.order)
  const doneCount = Object.values(stepStatuses).filter(s => s === 'done').length
  const totalSuccess = stepResults.length > 0 && stepResults.every(r => r.overallSuccess)
  const totalFail = stepResults.length > 0 && stepResults.some(r => !r.overallSuccess)
  const totalMs = stepResults.reduce((acc, r) => acc + r.result.durationMs, 0)

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* Scenario list */}
      <div className="w-52 shrink-0 flex flex-col gap-1 overflow-y-auto">
        <button
          className="w-full py-1.5 px-3 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium mb-1"
          onClick={newScenario}
        >
          + 새 시나리오
        </button>
        {scenarios.map(s => (
          <button
            key={s.id}
            className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
              selectedId === s.id ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => selectScenario(s)}
          >
            <div className="font-medium truncate">{s.name || '(이름 없음)'}</div>
            <div className="text-xs text-slate-500">{s.steps.length}단계</div>
          </button>
        ))}
      </div>

      {/* Editor + results */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white font-medium"
              placeholder="시나리오 이름"
              value={editing.name}
              onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
            />
            <input
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-300"
              placeholder="설명 (선택)"
              value={editing.description}
              onChange={e => setEditing(ed => ({ ...ed, description: e.target.value }))}
            />
            {canWrite() && (
              <button
                className="px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 text-white text-sm disabled:opacity-40"
                onClick={save}
                disabled={saving}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            )}
            {canWrite() && !isNew && (
              <button
                className="px-3 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white text-sm"
                onClick={deleteScenario}
              >
                삭제
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Stop on failure */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-slate-500 accent-red-500"
                checked={editing.stopOnFailure}
                onChange={e => setEditing(ed => ({ ...ed, stopOnFailure: e.target.checked }))}
              />
              <span className="text-xs text-slate-400">실패 시 중단</span>
            </label>

            <div className="flex-1" />

            {/* Progress indicator */}
            {running && (
              <span className="text-xs text-blue-300">
                {doneCount} / {sorted.length} 완료
              </span>
            )}
            {!running && stepResults.length > 0 && (
              <span className={`text-xs ${totalSuccess ? 'text-green-400' : totalFail ? 'text-red-400' : 'text-slate-400'}`}>
                {totalSuccess ? '✅ 전체 성공' : totalFail ? '❌ 일부 실패' : ''} · {totalMs}ms
              </span>
            )}

            {canWrite() && (running ? (
              <button
                className="px-4 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white text-sm font-medium"
                onClick={stopRun}
              >
                ■ 중단
              </button>
            ) : (
              <button
                className="px-4 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-sm font-medium disabled:opacity-40"
                onClick={() => { clearRunState(); run() }}
                disabled={sorted.length === 0}
              >
                ▶ 실행
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {sorted.map((step, i) => (
            <StepEditor
              key={step.order}
              step={step}
              isFirst={i === 0}
              units={units}
              onChange={s => updateStep(editing.steps.findIndex(es => es.order === step.order), s)}
              onDelete={() => deleteStep(editing.steps.findIndex(es => es.order === step.order))}
            />
          ))}
          <button
            className="w-full py-2 rounded border border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-sm transition-colors"
            onClick={addStep}
          >
            + 단계 추가
          </button>
        </div>

        {/* Run results */}
        {(running || stepResults.length > 0) && (
          <div className="space-y-2 pt-1">
            <div className="text-xs text-slate-400 font-medium border-t border-slate-700 pt-3">실행 결과</div>
            {sorted.map(step => {
              const status = stepStatuses[step.order] ?? 'idle'
              const result = stepResults.find(r => r.stepOrder === step.order)
              if (status === 'idle') return null
              return (
                <div key={step.order}>
                  <div className="text-xs text-slate-500 mb-1">
                    Step {step.order} · {step.name}
                  </div>
                  <StepResultCard
                    stepResult={result}
                    status={status}
                    order={step.order}
                    name={step.name}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Log Play: Entry Row ───────────────────────────────────────────────────────

function LogEntryRow({
  entry,
  selected,
  onToggle,
  result,
  isRunning,
}: {
  entry: LogPlayEntry
  selected: boolean
  onToggle: () => void
  result?: LogPlayRunResultItem
  isRunning?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [showTrace, setShowTrace] = useState(false)

  const ts = new Date(entry.timestamp)
  const pad = (x: number, n = 2) => String(x).padStart(n, '0')
  const timeStr = `${pad(ts.getUTCHours())}:${pad(ts.getUTCMinutes())}:${pad(ts.getUTCSeconds())}.${pad(ts.getUTCMilliseconds(), 3)}`

  let msgPreview = entry.message
  try { msgPreview = JSON.stringify(JSON.parse(entry.message), null, 2) } catch { /* keep raw */ }

  const borderColor = isRunning
    ? 'border-blue-500/80'
    : result
      ? result.result.success ? 'border-green-700/60' : 'border-red-700/60'
      : 'border-slate-600'
  const bgColor = isRunning
    ? 'bg-blue-900/20'
    : result
      ? result.result.success ? 'bg-green-900/20' : 'bg-red-900/20'
      : 'bg-slate-800'

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${bgColor} hover:brightness-110`}
        onClick={() => setExpanded(o => !o)}
      >
        <input
          type="checkbox"
          className="accent-blue-500 shrink-0"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
        />
        <span className="font-mono text-[10px] text-slate-500 shrink-0">{entry.traceId.slice(0, 8)}…</span>
        <span className="text-xs text-slate-300 flex-1 truncate">{entry.workflowUnitName || entry.workflowUnitId}</span>
        <span className="text-[10px] text-slate-500 shrink-0 font-mono">{timeStr} UTC</span>
        {isRunning && (
          <span className="text-xs text-blue-400 shrink-0 animate-pulse">실행 중...</span>
        )}
        {!isRunning && result && (
          <span className={`text-xs shrink-0 ${result.result.success ? 'text-green-400' : 'text-red-400'}`}>
            {result.result.success ? '✓' : '✗'} {result.result.durationMs}ms
          </span>
        )}
        <span className="text-slate-500 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="p-3 bg-slate-800/60 space-y-2 border-t border-slate-700">
          <div>
            <div className="text-[10px] text-slate-400 mb-1">수신 메세지 (messageSnippet)</div>
            <pre className="text-[10px] font-mono text-slate-300 bg-slate-900 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
              {msgPreview}
            </pre>
          </div>
          {result && (
            <div>
              <button
                className="text-xs text-slate-400 hover:text-slate-200 mb-1 flex items-center gap-1"
                onClick={() => setShowTrace(o => !o)}
              >
                파이프라인 트레이스 {showTrace ? '▲' : '▼'}
              </button>
              {showTrace && (
                <PipelineTraceView
                  traces={result.result.nodeTraces}
                  success={result.result.success}
                  response={result.result.response}
                  errorMessage={result.result.errorMessage}
                  durationMs={result.result.durationMs}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Log Play Tab ──────────────────────────────────────────────────────────────

function LogPlayTab({ units }: { units: WorkflowUnitSummary[] }) {
  const { canWrite } = useAuthStore()
  const [datetimeFrom, setDatetimeFrom] = useState(localDatetimeMinsAgo(5))
  const [datetimeTo, setDatetimeTo] = useState(localDatetimeNow)
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set())
  const [logEntries, setLogEntries] = useState<LogPlayEntry[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hasFetched, setHasFetched] = useState(false)
  const [selectedTraceIds, setSelectedTraceIds] = useState<Set<string>>(new Set())
  // unitId → list of NODE4 nodes
  const [node4ByUnit, setNode4ByUnit] = useState<Record<string, ExtendedNode4Info[]>>({})
  const [node4Overrides, setNode4Overrides] = useState<Record<string, { host: string; port: string; ip: string }>>({})
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<LogPlayRunResultItem[]>([])
  const [runError, setRunError] = useState<string | null>(null)
  const [delayMs, setDelayMs] = useState(0)
  const [runningTraceId, setRunningTraceId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const abortRef = useRef(false)

  // 선택된 유닛들의 NODE4 정보를 유닛별로 조회
  useEffect(() => {
    if (selectedUnitIds.size === 0) { setNode4ByUnit({}); return }
    const ids = Array.from(selectedUnitIds)
    Promise.all(
      ids.map(id =>
        authFetch(`/synapse/workflow/units/${id}`)
          .then(r => r.json())
          .then(json => {
            const nodes: RawNode[] = json.data?.nodes ?? []
            const n4 = nodes
              .filter(n => n.nodeType === 'NODE4' && n.node4)
              .map(n => ({
                nodeId: n.id,
                unitId: id,
                label: `${n.node4!.protocol} → ${n.node4!.targetHost ?? '?'}:${n.node4!.targetPort ?? '?'}`,
                protocol: n.node4!.protocol,
                currentHost: n.node4!.targetHost,
                currentPort: n.node4!.targetPort,
                replyToSelf: (n.node4 as any).replyToSelf,
                currentTargetIp: n.node4!.targetPath ?? undefined,
              } as ExtendedNode4Info))
            return { id, n4 }
          })
          .catch(() => ({ id, n4: [] as ExtendedNode4Info[] }))
      )
    ).then(results => {
      const map: Record<string, ExtendedNode4Info[]> = {}
      for (const { id, n4 } of results) { if (n4.length > 0) map[id] = n4 }
      setNode4ByUnit(map)
    })
  }, [selectedUnitIds])

  function toggleUnit(unitId: string) {
    setSelectedUnitIds(prev => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId); else next.add(unitId)
      return next
    })
  }

  function toggleTraceId(traceId: string) {
    setSelectedTraceIds(prev => {
      const next = new Set(prev)
      if (next.has(traceId)) next.delete(traceId); else next.add(traceId)
      return next
    })
  }

  function setOverride(nodeId: string, field: 'host' | 'port' | 'ip', value: string) {
    setNode4Overrides(prev => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] ?? { host: '', port: '', ip: '' }), [field]: value },
    }))
  }

  async function fetchLogs() {
    if (selectedUnitIds.size === 0) return
    setFetching(true)
    setFetchError(null)
    setLogEntries([])
    setSelectedTraceIds(new Set())
    setResults([])
    setRunError(null)
    try {
      const utcFrom = new Date(datetimeFrom).toISOString().slice(0, 19) + 'Z'
      const utcTo   = new Date(datetimeTo).toISOString().slice(0, 19) + 'Z'
      const res = await authFetch('/synapse/simulator/log-play/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datetimeFrom: utcFrom, datetimeTo: utcTo, unitIds: Array.from(selectedUnitIds) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      const entries: LogPlayEntry[] = json.data ?? []
      setLogEntries(entries)
      setSelectedTraceIds(new Set(entries.map(e => e.traceId)))
    } catch (e) {
      setFetchError(String(e))
    } finally {
      setFetching(false)
      setHasFetched(true)
    }
  }

  async function run() {
    const selected = logEntries.filter(e => selectedTraceIds.has(e.traceId))
    if (selected.length === 0) return
    abortRef.current = false
    setRunning(true)
    setResults([])
    setRunError(null)
    setProgress({ current: 0, total: selected.length })

    const overridesPayload = Object.fromEntries(
      Object.entries(node4Overrides)
        .filter(([_, v]) => v.host.trim() || v.port.trim() || v.ip.trim())
        .map(([nodeId, v]) => [nodeId, {
          host: v.host.trim() || undefined,
          port: v.port.trim() ? parseInt(v.port) : undefined,
          targetIp: v.ip.trim() || undefined,
        }])
    )

    for (let i = 0; i < selected.length; i++) {
      if (abortRef.current) break
      const entry = selected[i]
      setRunningTraceId(entry.traceId)
      setProgress({ current: i + 1, total: selected.length })
      try {
        const res = await authFetch('/synapse/simulator/log-play/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: [entry], node4Overrides: overridesPayload }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '실행 실패')
        const items: LogPlayRunResultItem[] = json.data ?? []
        setResults(prev => [...prev, ...items])
      } catch (e) {
        setRunError(String(e))
        break
      }
      if (delayMs > 0 && i < selected.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }

    setRunningTraceId(null)
    setProgress(null)
    setRunning(false)
  }

  function stop() {
    abortRef.current = true
  }

  const selectedLogs = logEntries.filter(e => selectedTraceIds.has(e.traceId))
  // unitId → unit name (for labels)
  const unitNameMap = Object.fromEntries(units.map(u => [u.id, u.name]))
  // units with at least one overridable NODE4
  const unitsWithOverride = Object.entries(node4ByUnit).filter(([_, nodes]) =>
    nodes.some(n => supportsHostPortOverride(n.protocol) || supportsTargetIpOverrideExt(n))
  )

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* Left: config */}
      <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">

        {/* Time range */}
        <div className="space-y-1.5">
          <label className="block text-xs text-slate-400">
            조회 기간
            <span className="text-slate-500 ml-1">(현지 시간)</span>
          </label>
          <div>
            <div className="text-[10px] text-slate-500 mb-0.5">시작</div>
            <input
              type="datetime-local"
              step="1"
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              value={datetimeFrom}
              onChange={e => setDatetimeFrom(e.target.value)}
            />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-0.5">종료</div>
            <input
              type="datetime-local"
              step="1"
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              value={datetimeTo}
              onChange={e => setDatetimeTo(e.target.value)}
            />
          </div>
          {/* Quick range shortcuts */}
          <div className="flex gap-1 flex-wrap">
            {([
              { label: '1분', mins: 1 },
              { label: '5분', mins: 5 },
              { label: '30분', mins: 30 },
              { label: '1시간', mins: 60 },
            ] as { label: string; mins: number }[]).map(({ label, mins }) => (
              <button
                key={mins}
                className="px-2 py-0.5 text-[10px] rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors"
                onClick={() => { setDatetimeFrom(localDatetimeMinsAgo(mins)); setDatetimeTo(localDatetimeNow()) }}
              >
                최근 {label}
              </button>
            ))}
          </div>
        </div>

        {/* Unit selection */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-400">워크플로우 유닛</label>
            <div className="flex gap-1.5">
              <button
                className="text-[10px] text-blue-400 hover:text-blue-300"
                onClick={() => setSelectedUnitIds(new Set(units.map(u => u.id)))}
              >전체</button>
              <span className="text-slate-600 text-[10px]">/</span>
              <button
                className="text-[10px] text-slate-400 hover:text-slate-300"
                onClick={() => setSelectedUnitIds(new Set())}
              >해제</button>
            </div>
          </div>
          <div className="space-y-0.5 max-h-44 overflow-y-auto border border-slate-700 rounded p-1">
            {units.length === 0 && (
              <div className="text-xs text-slate-500 italic px-2 py-1">유닛 없음</div>
            )}
            {units.map(u => (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-blue-500 shrink-0"
                  checked={selectedUnitIds.has(u.id)}
                  onChange={() => toggleUnit(u.id)}
                />
                <span className="text-xs text-slate-300 truncate" title={u.name}>{u.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Fetch button */}
        <button
          className="w-full py-2 rounded bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
          onClick={fetchLogs}
          disabled={fetching || selectedUnitIds.size === 0}
        >
          {fetching ? '조회 중...' : '로그 불러오기'}
        </button>

        {/* Delay setting */}
        <div className="space-y-1.5">
          <label className="block text-xs text-slate-400">메세지 간 전송 간격</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              step={100}
              className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
              value={delayMs}
              onChange={e => setDelayMs(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <span className="text-[10px] text-slate-500">ms</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {([
              { label: '즉시', ms: 0 },
              { label: '100ms', ms: 100 },
              { label: '500ms', ms: 500 },
              { label: '1s', ms: 1000 },
              { label: '3s', ms: 3000 },
              { label: '5s', ms: 5000 },
            ] as { label: string; ms: number }[]).map(({ label, ms }) => (
              <button
                key={ms}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  delayMs === ms
                    ? 'border-blue-500 text-blue-300 bg-blue-900/30'
                    : 'border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400'
                }`}
                onClick={() => setDelayMs(ms)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* NODE4 overrides — grouped by unit */}
        {unitsWithOverride.length > 0 && (
          <div className="border-t border-slate-700 pt-3 space-y-3">
            <div>
              <label className="block text-xs text-slate-400">NODE4 주소 오버라이드</label>
              <p className="text-[10px] text-slate-500 mt-0.5">비워두면 워크플로우 설정 주소를 사용합니다.</p>
            </div>
            {unitsWithOverride.map(([unitId, nodes]) => {
              const hostPortNodes = nodes.filter(n => supportsHostPortOverride(n.protocol))
              const targetIpNodes = nodes.filter(n => supportsTargetIpOverrideExt(n))
              return (
                <div key={unitId} className="space-y-1.5">
                  {/* Unit name header */}
                  <div className="flex items-center gap-1.5">
                    <div className="h-px flex-1 bg-slate-700" />
                    <span className="text-[10px] font-medium text-blue-400 shrink-0 truncate max-w-[160px]" title={unitNameMap[unitId]}>
                      {unitNameMap[unitId] ?? unitId}
                    </span>
                    <div className="h-px flex-1 bg-slate-700" />
                  </div>
                  {hostPortNodes.map(n => {
                    const ov = node4Overrides[n.nodeId] ?? { host: '', port: '', ip: '' }
                    return (
                      <div key={n.nodeId}>
                        <div className="text-[10px] text-slate-500 mb-0.5">{n.protocol}</div>
                        <div className="flex gap-1">
                          <input
                            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                            placeholder={n.currentHost ?? 'host'}
                            value={ov.host}
                            onChange={e => setOverride(n.nodeId, 'host', e.target.value)}
                          />
                          <input
                            className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                            placeholder={n.currentPort != null ? String(n.currentPort) : 'port'}
                            type="number"
                            value={ov.port}
                            onChange={e => setOverride(n.nodeId, 'port', e.target.value)}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {targetIpNodes.map(n => {
                    const ov = node4Overrides[n.nodeId] ?? { host: '', port: '', ip: '' }
                    return (
                      <div key={n.nodeId}>
                        <div className="text-[10px] text-slate-500 mb-0.5">{n.protocol} 대상 IP</div>
                        <input
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white"
                          placeholder={n.currentTargetIp ?? '예: 192.168.0.10'}
                          value={ov.ip}
                          onChange={e => setOverride(n.nodeId, 'ip', e.target.value)}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Right: logs + results */}
      <div className="flex-1 flex flex-col gap-2 overflow-hidden min-h-0">
        {/* Header bar */}
        {hasFetched && logEntries.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-400">{logEntries.length}개 로그</span>
            <div className="flex gap-1.5">
              <button
                className="text-[10px] text-blue-400 hover:text-blue-300"
                onClick={() => setSelectedTraceIds(new Set(logEntries.map(e => e.traceId)))}
                disabled={running}
              >전체 선택</button>
              <span className="text-slate-600 text-[10px]">/</span>
              <button
                className="text-[10px] text-slate-400 hover:text-slate-300"
                onClick={() => setSelectedTraceIds(new Set())}
                disabled={running}
              >전체 해제</button>
            </div>
            <div className="flex-1" />
            {runError && <span className="text-xs text-red-400 truncate max-w-48">{runError}</span>}
            {progress && (
              <span className="text-xs text-blue-400 shrink-0 font-mono">
                {progress.current}/{progress.total} 처리 중
              </span>
            )}
            {canWrite() && (running ? (
              <button
                className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors whitespace-nowrap"
                onClick={stop}
              >
                ■ 중지
              </button>
            ) : (
              <button
                className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-medium disabled:opacity-40 transition-colors whitespace-nowrap"
                onClick={run}
                disabled={selectedLogs.length === 0}
              >
                ▶ {selectedLogs.length}개 실행
              </button>
            ))}
          </div>
        )}

        {/* Log list */}
        <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          {fetchError && (
            <div className="text-xs text-red-400 px-3 py-2 bg-red-900/20 border border-red-800 rounded">{fetchError}</div>
          )}
          {!hasFetched && !fetching && (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              기간과 유닛을 선택하고 로그를 불러오세요
            </div>
          )}
          {hasFetched && logEntries.length === 0 && !fetching && !fetchError && (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              해당 기간에 로그가 없습니다
            </div>
          )}
          {logEntries.map(entry => (
            <LogEntryRow
              key={entry.traceId}
              entry={entry}
              selected={selectedTraceIds.has(entry.traceId)}
              onToggle={() => toggleTraceId(entry.traceId)}
              result={results.find(r => r.traceId === entry.traceId)}
              isRunning={runningTraceId === entry.traceId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type SimulatorTab = 'scenario' | 'logplay'

export default function SimulatorPage() {
  const [units, setUnits] = useState<WorkflowUnitSummary[]>([])
  const [activeTab, setActiveTab] = useState<SimulatorTab>('scenario')

  useEffect(() => {
    authFetch('/synapse/workflow/units')
      .then(r => r.json())
      .then(json => setUnits((json.data ?? []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))))
  }, [])

  return (
    <div className="flex flex-col h-full bg-slate-800 text-white">
      {/* Tab header */}
      <div className="flex items-center border-b border-slate-700 shrink-0 px-4 pt-3 gap-1">
        {([
          { key: 'scenario', label: '시나리오 테스트' },
          { key: 'logplay', label: '로그 플레이' },
        ] as { key: SimulatorTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              activeTab === tab.key
                ? 'bg-slate-700 text-white font-medium border border-b-0 border-slate-600'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        {activeTab === 'scenario' && (
          <span className="text-xs text-slate-500 ml-2">
            — 단일 파이프라인 테스트는 워크플로우 캔버스 ▶ 테스트 버튼을 이용하세요
          </span>
        )}
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'scenario' ? (
          <ScenarioTab units={units} />
        ) : (
          <LogPlayTab units={units} />
        )}
      </div>
    </div>
  )
}
