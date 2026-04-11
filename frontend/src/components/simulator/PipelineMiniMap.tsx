// Mini pipeline tree visualization used in the scenario step editor.
// Renders the unit's node graph as an indented tree (Unix-tree style with │ connectors)
// and embeds NODE4 host/port override inputs directly on each NODE4 row.

const NODE_COLORS: Record<string, string> = {
  NODE0: 'bg-slate-500 text-white',
  NODE1: 'bg-blue-700 text-white',
  NODE2: 'bg-violet-700 text-white',
  NODE3: 'bg-cyan-700 text-white',
  NODE4: 'bg-orange-600 text-white',
  NODE5: 'bg-emerald-700 text-white',
}

const NODE_LABELS: Record<string, string> = {
  NODE0: '수신',
  NODE1: '입력 DTO',
  NODE2: '변환',
  NODE3: '출력 DTO',
  NODE4: '송신',
  NODE5: '응답',
}

export interface RawNode {
  id: string
  nodeType: string
  node0?: { protocol: string; path?: string }
  node1?: { messageFormat: string }
  node4?: { protocol: string; targetHost?: string; targetPort?: number; targetPath?: string | null }
}

export interface RawEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  isDashed: boolean
}

interface TreeNode {
  node: RawNode
  children: TreeNode[]
}

function buildTree(nodes: RawNode[], edges: RawEdge[]): TreeNode[] {
  const forwardEdges = edges.filter(e => !e.isDashed)
  const childMap = new Map<string, string[]>()
  const hasIncoming = new Set<string>()

  for (const e of forwardEdges) {
    if (!childMap.has(e.sourceNodeId)) childMap.set(e.sourceNodeId, [])
    childMap.get(e.sourceNodeId)!.push(e.targetNodeId)
    hasIncoming.add(e.targetNodeId)
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const roots = nodes.filter(n => !hasIncoming.has(n.id))

  function buildNode(nodeId: string, visited: Set<string>): TreeNode | null {
    if (visited.has(nodeId)) return null
    visited.add(nodeId)
    const node = nodeMap.get(nodeId)
    if (!node) return null
    const children = (childMap.get(nodeId) ?? [])
      .map(id => buildNode(id, visited))
      .filter((c): c is TreeNode => c !== null)
    return { node, children }
  }

  return roots
    .map(r => buildNode(r.id, new Set()))
    .filter((c): c is TreeNode => c !== null)
}

function nodeSubLabel(node: RawNode): string {
  if (node.nodeType === 'NODE0' && node.node0) {
    return node.node0.path ? `${node.node0.protocol}  ${node.node0.path}` : node.node0.protocol
  }
  if (node.nodeType === 'NODE1' && node.node1) return node.node1.messageFormat
  if (node.nodeType === 'NODE4' && node.node4) {
    const dest = [node.node4.targetHost, node.node4.targetPort].filter(Boolean).join(':')
    return `${node.node4.protocol}${dest ? `  →  ${dest}` : ''}`
  }
  return NODE_LABELS[node.nodeType] ?? node.nodeType
}

interface OverrideValue { host: string; port: string; ip: string }

// ancestorContinuations[i] = true  →  ancestor at depth i has more siblings → draw │
//                           = false →  ancestor at depth i was last child    → draw space
interface TreeNodeRowProps {
  treeNode: TreeNode
  ancestorContinuations: boolean[]   // length === current depth
  isLast: boolean
  overrides: Record<string, OverrideValue>
  onOverrideChange: (nodeId: string, field: 'host' | 'port' | 'ip', value: string) => void
}

const INDENT_W = 14  // px per depth level

function TreeNodeRow({ treeNode, ancestorContinuations, isLast, overrides, onOverrideChange }: TreeNodeRowProps) {
  const { node, children } = treeNode
  const depth = ancestorContinuations.length
  const isNode4 = node.nodeType === 'NODE4'
  const isServerNode4 = isNode4 && node.node4?.protocol.endsWith('_SERVER') === true
  const isClientNode4 = isNode4 && !isServerNode4
  // 서버 프로토콜은 targetPath가 null이 아닐 때(IP 라우팅 모드)만 오버라이드 가능
  const isServerIpNode4 = isServerNode4 && node.node4?.targetPath != null
  const ov = (isClientNode4 || isServerIpNode4)
    ? (overrides[node.id] ?? { host: '', port: '', ip: '' })
    : null

  // Build the prefix string: one character-slot per ancestor depth
  // Each slot is either '│ ' (ancestor continues) or '  ' (ancestor done)
  const prefixParts: string[] = ancestorContinuations.map(cont => (cont ? '│' : ' '))

  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5">
        {/* Ancestor continuation lines */}
        {prefixParts.map((ch, i) => (
          <span
            key={i}
            className="text-slate-600 text-xs select-none shrink-0 font-mono"
            style={{ width: INDENT_W, textAlign: 'center' }}
          >
            {ch}
          </span>
        ))}

        {/* Branch glyph for this node */}
        {depth > 0 && (
          <span className="text-slate-600 text-xs select-none shrink-0 font-mono" style={{ width: INDENT_W, textAlign: 'center' }}>
            {isLast ? '└' : '├'}
          </span>
        )}

        {/* Node badge */}
        <span className={`text-xs px-1.5 py-0.5 rounded font-bold shrink-0 ${NODE_COLORS[node.nodeType] ?? 'bg-slate-600 text-white'}`}>
          {node.nodeType}
        </span>

        {/* Sub-label */}
        <span className="text-xs text-slate-400 font-mono truncate min-w-0">
          {nodeSubLabel(node)}
        </span>

        {/* Inline override inputs: 클라이언트 → host/port, 서버 IP 모드 → ip */}
        {isClientNode4 && ov !== null && (
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <span className="text-[10px] text-amber-500/80 shrink-0 select-none" title="테스트 실행 시 이 주소로 오버라이드됩니다. 비워두면 워크플로우 설정값 사용.">
              ✎ 주소 오버라이드
            </span>
            <input
              className="w-24 bg-slate-700 border border-amber-700/50 rounded px-1.5 py-0.5 text-xs text-white font-mono"
              placeholder={node.node4?.targetHost ?? 'host'}
              title="테스트용 host 오버라이드 (비워두면 워크플로우 설정값 사용)"
              value={ov.host}
              onChange={e => onOverrideChange(node.id, 'host', e.target.value)}
            />
            <input
              className="w-16 bg-slate-700 border border-amber-700/50 rounded px-1.5 py-0.5 text-xs text-white font-mono"
              placeholder={node.node4?.targetPort != null ? String(node.node4.targetPort) : 'port'}
              title="테스트용 port 오버라이드 (비워두면 워크플로우 설정값 사용)"
              type="number"
              value={ov.port}
              onChange={e => onOverrideChange(node.id, 'port', e.target.value)}
            />
          </div>
        )}
        {isServerIpNode4 && ov !== null && (
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <span className="text-[10px] text-amber-500/80 shrink-0 select-none" title="테스트 실행 시 이 IP로 오버라이드됩니다. 비워두면 워크플로우 설정값 사용.">
              ✎ IP 오버라이드
            </span>
            <input
              className="w-32 bg-slate-700 border border-amber-700/50 rounded px-1.5 py-0.5 text-xs text-white font-mono"
              placeholder={node.node4?.targetPath ?? '대상 IP'}
              title="테스트용 대상 IP 오버라이드 (비워두면 워크플로우 설정값 사용)"
              value={ov.ip}
              onChange={e => onOverrideChange(node.id, 'ip', e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Children — pass down whether this node continues (has more siblings at this depth) */}
      {children.map((child, i) => (
        <TreeNodeRow
          key={child.node.id}
          treeNode={child}
          // Append to continuations: this level continues if current node is NOT last
          ancestorContinuations={[...ancestorContinuations, !isLast]}
          isLast={i === children.length - 1}
          overrides={overrides}
          onOverrideChange={onOverrideChange}
        />
      ))}
    </div>
  )
}

interface Props {
  nodes: RawNode[]
  edges: RawEdge[]
  overrides: Record<string, OverrideValue>
  onOverrideChange: (nodeId: string, field: 'host' | 'port' | 'ip', value: string) => void
}

export default function PipelineMiniMap({ nodes, edges, overrides, onOverrideChange }: Props) {
  const roots = buildTree(nodes, edges)
  if (roots.length === 0) return null

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs">
      {roots.map((root, i) => (
        <TreeNodeRow
          key={root.node.id}
          treeNode={root}
          ancestorContinuations={[]}
          isLast={i === roots.length - 1}
          overrides={overrides}
          onOverrideChange={onOverrideChange}
        />
      ))}
    </div>
  )
}
