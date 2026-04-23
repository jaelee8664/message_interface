import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Node3Definition, DtoMapping, ListAddItem, ListAddItemType, FixedValueType, WorkflowUnit, FieldDefinition, Node1Definition, FieldType, ItemFieldMapping } from '../../types/workflow'
import { InputField } from '../ui/FormField'
import FieldStructurePreview from '../ui/FieldStructurePreview'
import CodeAiAssist from '../llm/CodeAiAssist'

export interface Node3PanelHandle {
  getUpdatedDefinition: () => Node3Definition | null
}

interface Props {
  definition: Node3Definition | undefined
  onChange: (def: Node3Definition) => void
  currentNodeId: string
  unit: WorkflowUnit
}

const DEFAULT_DEF: Node3Definition = { mappings: [] }
const DEFAULT_MAPPING: DtoMapping = { newKey: '', beforeKey: '', filterCode: '' }

function collectNode1Keys(node1: Node1Definition): string[] {
  const keys: string[] = []

  function expand(fields: FieldDefinition[], prefix: string) {
    for (const f of fields) {
      const key = prefix ? `${prefix}.${f.key}` : f.key
      if (f.type === 'CUSTOM' && f.customTypeName) {
        const dto = (node1.customDtos ?? []).find(d => d.name === f.customTypeName)
        if (dto) {
          expand(dto.fields ?? [], key)
          continue
        }
      }
      keys.push(key)
    }
  }

  expand(node1.fields ?? [], '')
  return keys
}

/** Collect all field keys available at the given node's position by traversing upstream. */
function collectAvailableKeys(nodeId: string, unit: WorkflowUnit): string[] {
  const visited = new Set<string>()
  const keys: string[] = []

  function traverse(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const incoming = (unit.edges ?? []).filter(e => e.targetNodeId === id && !e.isDashed)
    for (const edge of incoming) {
      const src = (unit.nodes ?? []).find(n => n.id === edge.sourceNodeId)
      if (!src) continue
      if (src.nodeType === 'NODE1' && src.node1) {
        keys.push(...collectNode1Keys(src.node1))
      } else if (src.nodeType === 'NODE2' && src.node2) {
        for (const rule of (src.node2.customCodeRules ?? [])) {
          if (rule.key) keys.push(rule.key)
        }
        traverse(src.id)
      } else {
        traverse(src.id)
      }
    }
  }

  traverse(nodeId)
  return [...new Set(keys)]
}

interface ImportItem { key: string; newKey: string; checked: boolean }

const FIXED_TYPES: FixedValueType[] = ['STRING', 'INT', 'DOUBLE', 'BOOLEAN']

function findUpstreamNode1(nodeId: string, unit: WorkflowUnit): Node1Definition | null {
  const visited = new Set<string>()
  function traverse(id: string): Node1Definition | null {
    if (visited.has(id)) return null
    visited.add(id)
    for (const edge of (unit.edges ?? []).filter(e => e.targetNodeId === id && !e.isDashed)) {
      const src = (unit.nodes ?? []).find(n => n.id === edge.sourceNodeId)
      if (!src) continue
      if (src.nodeType === 'NODE1' && src.node1) return src.node1
      const found = traverse(src.id)
      if (found) return found
    }
    return null
  }
  return traverse(nodeId)
}

function defaultValueLiteral(type: FieldType): string {
  switch (type) {
    case 'STRING':  return '""'
    case 'INT':     return '0'
    case 'DOUBLE':  return '0.0'
    case 'BOOLEAN': return 'false'
    case 'LIST':    return '[]'
    default:        return '{}'
  }
}

/** Resolve the FieldDefinition for a dot-notation key (e.g. "body.items") from a Node1 schema. */
function resolveFieldDefFromNode1(beforeKey: string, node1: Node1Definition): FieldDefinition | null {
  const parts = beforeKey.split('.').map(p => p.replace(/\[.*?\]/g, ''))
  let fields = node1.fields ?? []
  let current: FieldDefinition | null = null
  for (const part of parts) {
    current = fields.find(f => f.key === part) ?? null
    if (!current) return null
    if (current.type === 'CUSTOM' && current.customTypeName) {
      const dto = (node1.customDtos ?? []).find(d => d.name === current!.customTypeName)
      fields = dto?.fields ?? []
    } else if (current.type === 'LIST' && current.listItemType === 'CUSTOM' && current.customTypeName) {
      const dto = (node1.customDtos ?? []).find(d => d.name === current!.customTypeName)
      fields = dto?.fields ?? []
    }
  }
  return current
}

function formatFieldInfo(fieldDef: FieldDefinition | null): string {
  if (!fieldDef) return 'unknown'

  let typeLabel: string = fieldDef.type
  if (fieldDef.type === 'LIST') {
    const itemType = fieldDef.listItemType || 'UNKNOWN'
    typeLabel = `List<${itemType}>`
  } else if (fieldDef.type === 'CUSTOM') {
    typeLabel = fieldDef.customTypeName ? `CUSTOM(${fieldDef.customTypeName})` : 'CUSTOM'
  }

  const nullability = fieldDef.nullable ? 'nullable' : 'non-null'
  const mandatory = fieldDef.mandatory ? 'mandatory' : 'optional'
  return `${typeLabel} · ${nullability} · ${mandatory}`
}

function formatRowKeyInfo(key: string, node1: Node1Definition | null): string {
  if (!node1 || !key) return ''
  const def = resolveFieldDefFromNode1(key, node1)
  const info = formatFieldInfo(def)
  return info ? `(${info})` : ''
}

function buildExprTemplate(beforeKey: string, node1: Node1Definition): string {
  const parts = beforeKey.split('.').map(p => p.replace(/\[.*?\]/g, ''))

  let fields = node1.fields
  let current: FieldDefinition | null = null
  for (const part of parts) {
    current = fields.find(f => f.key === part) ?? null
    if (!current) break
    if (current.type === 'CUSTOM' && current.customTypeName) {
      const dto = (node1.customDtos ?? []).find(d => d.name === current!.customTypeName)
      fields = dto?.fields ?? []
    }
  }

  if (!current || current.type !== 'LIST') return '({\n  \n})'

  if (current.listItemType === 'CUSTOM' && current.customTypeName) {
    const dto = (node1.customDtos ?? []).find(d => d.name === current.customTypeName)
    if (dto?.fields?.length) {
      const lines = dto.fields.map(f => `  ${f.key}: ${defaultValueLiteral(f.type)}`).join(',\n')
      return `({\n${lines}\n})`
    }
  }

  return `(${defaultValueLiteral(current.listItemType ?? 'STRING')})`
}

/** expr 문자열 → 필드별 값 파싱 */
function parseExprToFields(expr: string, fields: FieldDefinition[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of expr.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).replace(/,\s*$/, '').trim()
    if (fields.some(f => f.key === key)) result[key] = val
  }
  return result
}

/** 필드별 값 → expr 문자열 빌드 */
function buildExprFromFieldValues(values: Record<string, string>, fields: FieldDefinition[]): string {
  const lines = fields.map(f => `  ${f.key}: ${values[f.key] ?? ''}`)
  return `({\n${lines.join(',\n')}\n})`
}

function AddItemRow({
  item,
  availableKeys,
  generateTemplate,
  onChange,
  onRemove,
  listItemType,
  listItemDtoFields,
  unitId,
}: {
  item: ListAddItem
  availableKeys: string[]
  generateTemplate: () => string
  onChange: (item: ListAddItem) => void
  onRemove: () => void
  listItemType?: FieldType | null
  listItemDtoFields?: FieldDefinition[] | null
  unitId?: string
}) {
  const isCustomList = listItemType === 'CUSTOM' || listItemType === 'MAP'
  const allowedTypes: ListAddItemType[] = isCustomList ? ['EXPR'] : ['FIXED', 'FIELD_REF']
  const primitiveTypes: FieldType[] = ['STRING', 'INT', 'DOUBLE', 'BOOLEAN']
  const allowedFixedTypes: FixedValueType[] =
    listItemType && primitiveTypes.includes(listItemType)
      ? [listItemType as FixedValueType]
      : FIXED_TYPES

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    listItemDtoFields ? parseExprToFields(item.expr ?? '', listItemDtoFields) : {}
  )

  useEffect(() => {
    if (!allowedTypes.includes(item.type)) onChange({ type: allowedTypes[0] })
  }, [listItemType]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (listItemDtoFields) setFieldValues(parseExprToFields(item.expr ?? '', listItemDtoFields))
  }, [listItemDtoFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (key: string, value: string) => {
    const next = { ...fieldValues, [key]: value }
    setFieldValues(next)
    onChange({ ...item, expr: buildExprFromFieldValues(next, listItemDtoFields!) })
  }

  return (
    <div className="rounded bg-slate-700 border border-slate-600">
      <div className="flex items-center gap-2 px-2 py-1.5">
        {allowedTypes.length > 1 ? (
          <select
            value={item.type}
            onChange={e => onChange({ type: e.target.value as ListAddItemType })}
            className="text-xs rounded bg-slate-600 border border-slate-500 text-slate-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
          >
            <option value="FIXED">고정값</option>
            <option value="FIELD_REF">필드 참조</option>
          </select>
        ) : (
          <span className="text-xs text-slate-400 shrink-0">필드 매핑</span>
        )}

        {item.type === 'FIXED' ? (
          <>
            <select
              value={item.fixedType ?? ''}
              onChange={e => onChange({ ...item, fixedType: e.target.value as FixedValueType || undefined })}
              className="text-xs rounded bg-slate-600 border border-slate-500 text-slate-200 px-1 py-0.5 focus:outline-none focus:border-blue-500"
            >
              <option value="">null</option>
              {allowedFixedTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {item.fixedType && (
              <input
                type="text"
                value={item.fixedValue ?? ''}
                onChange={e => onChange({ ...item, fixedValue: e.target.value })}
                placeholder="값 입력"
                className="flex-1 min-w-0 px-2 py-0.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-yellow-300 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            )}
          </>
        ) : item.type === 'FIELD_REF' ? (
          <input
            type="text"
            value={item.fieldRef ?? ''}
            onChange={e => onChange({ ...item, fieldRef: e.target.value })}
            placeholder="예: body.userId"
            list="add-item-keys"
            className="flex-1 min-w-0 px-2 py-0.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-blue-300 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        ) : null}

        <datalist id="add-item-keys">
          {availableKeys.map(k => <option key={k} value={k} />)}
        </datalist>

        <button
          onClick={() => onChange({ ...item, prepend: !item.prepend })}
          className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${item.prepend ? 'bg-indigo-600 text-white' : 'bg-slate-600 text-slate-400'}`}
          title={item.prepend ? '앞에 추가' : '뒤에 추가'}
        >{item.prepend ? '앞' : '뒤'}</button>
        <button onClick={onRemove} className="text-slate-500 hover:text-red-400 px-1 text-xs shrink-0">✕</button>
      </div>

      {item.type === 'EXPR' && (
        listItemDtoFields && listItemDtoFields.length > 0 ? (
          /* DTO 필드별 구조화 매핑 */
          <div className="px-2 pb-2 space-y-1">
            <datalist id="add-item-field-keys">
              {availableKeys.map(k => <option key={k} value={`{$${k}}`} />)}
            </datalist>
            {listItemDtoFields.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono w-28 shrink-0 truncate" title={f.key}>{f.key}</span>
                <input
                  type="text"
                  value={fieldValues[f.key] ?? ''}
                  onChange={e => updateField(f.key, e.target.value)}
                  placeholder={`"문자열" · 123 · {$key}`}
                  list="add-item-field-keys"
                  className="flex-1 min-w-0 px-2 py-0.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-green-300 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        ) : (
          /* fallback: DTO 정보 없을 때 raw textarea (템플릿이 placeholder로) */
          <div className="px-2 pb-2 space-y-1">
            <textarea
              value={item.expr ?? ''}
              onChange={e => onChange({ ...item, expr: e.target.value })}
              placeholder={generateTemplate()}
              rows={5}
              className="w-full px-2 py-1.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-green-300 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-y"
            />
            <CodeAiAssist
              nodeType="NODE3"
              codeType="EXPR"
              existingCode={item.expr ?? ''}
              unitId={unitId}
              onApply={(code) => onChange({ ...item, expr: code })}
            />
          </div>
        )
      )}

      <div className="px-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 shrink-0">추가 조건</span>
          <input
            type="text"
            value={item.addCondition ?? ''}
            onChange={e => onChange({ ...item, addCondition: e.target.value || undefined })}
            placeholder='미입력 시 항상 추가 · 예: {$items}.length == 1 && {$items[0].qty} == 3'
            className="flex-1 min-w-0 px-2 py-0.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <CodeAiAssist
          nodeType="NODE3"
          codeType="ADD_CONDITION"
          existingCode={item.addCondition ?? ''}
          unitId={unitId}
          onApply={(code) => onChange({ ...item, addCondition: code || undefined })}
        />
      </div>
    </div>
  )
}

const Node3Panel = forwardRef<Node3PanelHandle, Props>(function Node3Panel({ definition, onChange, currentNodeId, unit }, ref) {
  const def = definition ?? DEFAULT_DEF
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const upstreamNode1 = findUpstreamNode1(currentNodeId, unit)
  const syntheticDtos: { name: string; fields: FieldDefinition[] }[] = []
  const previewFields: FieldDefinition[] = def.mappings.map(m => {
    if (upstreamNode1) {
      const resolved = resolveFieldDefFromNode1(m.beforeKey, upstreamNode1)
      if (resolved) {
        // itemMappings가 있으면 변환된 필드 구조로 synthetic DTO 생성
        if (m.itemMappings?.length && resolved.type === 'LIST' && resolved.listItemType === 'CUSTOM' && resolved.customTypeName) {
          const originalDto = (upstreamNode1.customDtos ?? []).find(d => d.name === resolved.customTypeName)
          if (originalDto) {
            const syntheticName = `__${m.newKey}_Item`
            const syntheticFields: FieldDefinition[] = m.itemMappings.map(im => {
              const orig = originalDto.fields.find(f => f.key === im.beforeKey)
              return orig
                ? { ...orig, key: im.newKey, description: im.newKey }
                : { key: im.newKey, type: 'STRING' as FieldType, nullable: false, mandatory: true, description: im.newKey }
            })
            syntheticDtos.push({ name: syntheticName, fields: syntheticFields })
            return { ...resolved, key: m.newKey, description: m.newKey, customTypeName: syntheticName }
          }
        }
        return { ...resolved, key: m.newKey, description: m.newKey }
      }
    }
    return { key: m.newKey, type: 'STRING' as FieldType, nullable: false, mandatory: true, description: m.newKey }
  })
  const [editingMapping, setEditingMapping] = useState<DtoMapping>(DEFAULT_MAPPING)
  const [showImport, setShowImport] = useState(false)
  const [importItems, setImportItems] = useState<ImportItem[]>([])

  const availableKeys = collectAvailableKeys(currentNodeId, unit)
  const editingFieldDef = upstreamNode1 ? resolveFieldDefFromNode1(editingMapping.beforeKey, upstreamNode1) : null
  const isEditingList = editingFieldDef ? editingFieldDef.type === 'LIST' : true
  const editingListItemType = editingFieldDef?.listItemType ?? null
  const editingListDtoFields =
    editingFieldDef?.listItemType === 'CUSTOM' && editingFieldDef.customTypeName && upstreamNode1
      ? (upstreamNode1.customDtos ?? []).find(d => d.name === editingFieldDef.customTypeName)?.fields ?? null
      : null

  useImperativeHandle(ref, () => ({
    getUpdatedDefinition(): Node3Definition | null {
      if (editingIndex === null) return null
      if (!editingMapping.newKey || !editingMapping.beforeKey) return null
      const newMappings = [...def.mappings]
      newMappings[editingIndex] = editingMapping
      return { ...def, mappings: newMappings }
    }
  }), [editingIndex, editingMapping, def])

  const addMapping = () => {
    setEditingMapping({ ...DEFAULT_MAPPING })
    setEditingIndex(def.mappings.length)
  }

  const saveMapping = () => {
    if (!editingMapping.newKey || !editingMapping.beforeKey) return
    const newMappings = [...def.mappings]
    if (editingIndex !== null) newMappings[editingIndex] = editingMapping
    onChange({ ...def, mappings: newMappings })
    setEditingIndex(null)
  }

  const openImport = () => {
    const allKeys = collectAvailableKeys(currentNodeId, unit)
    setImportItems(allKeys.map(k => ({ key: k, newKey: k, checked: true })))
    setShowImport(true)
  }

  const confirmImport = () => {
    const existing = new Set(def.mappings.map(m => m.beforeKey))
    const newMappings = [
      ...def.mappings,
      ...importItems
        .filter(item => item.checked && !existing.has(item.key))
        .map(item => ({ newKey: item.newKey, beforeKey: item.key })),
    ]
    onChange({ ...def, mappings: newMappings })
    setShowImport(false)
  }

  const updateAddItem = (idx: number, item: ListAddItem) => {
    const items = [...(editingMapping.listAddItems ?? [])]
    items[idx] = item
    setEditingMapping({ ...editingMapping, listAddItems: items })
  }

  const removeAddItem = (idx: number) => {
    const items = (editingMapping.listAddItems ?? []).filter((_, i) => i !== idx)
    setEditingMapping({ ...editingMapping, listAddItems: items.length ? items : undefined })
  }

  const appendAddItem = () => {
    const items = [...(editingMapping.listAddItems ?? []), { type: 'FIXED' as const, fixedType: 'STRING' as const, fixedValue: '' }]
    setEditingMapping({ ...editingMapping, listAddItems: items })
  }

  const addItemMapping = () => {
    const mappings = [...(editingMapping.itemMappings ?? []), { newKey: '', beforeKey: '' } as ItemFieldMapping]
    setEditingMapping({ ...editingMapping, itemMappings: mappings })
  }

  const updateItemMapping = (idx: number, m: ItemFieldMapping) => {
    const mappings = [...(editingMapping.itemMappings ?? [])]
    mappings[idx] = m
    setEditingMapping({ ...editingMapping, itemMappings: mappings })
  }

  const removeItemMapping = (idx: number) => {
    const mappings = (editingMapping.itemMappings ?? []).filter((_, i) => i !== idx)
    setEditingMapping({ ...editingMapping, itemMappings: mappings.length ? mappings : undefined })
  }

  const allChecked = importItems.length > 0 && importItems.every(i => i.checked)
  const hasIncomingEdge = (unit.edges ?? []).some(e => e.targetNodeId === currentNodeId && !e.isDashed)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">Output DTO 매핑</span>
        <div className="flex gap-2">
          <button
            onClick={openImport}
            disabled={!hasIncomingEdge}
            title={!hasIncomingEdge ? '연결된 상위 노드가 없습니다' : '상위 노드 필드 자동 불러오기'}
            className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            필드 불러오기
          </button>
          <button onClick={addMapping} className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">
            + 추가
          </button>
        </div>
      </div>

      {showImport && (
        <div className="p-3 rounded bg-slate-800 border border-emerald-600 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-300">상위 노드 필드 선택</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={e => setImportItems(importItems.map(i => ({ ...i, checked: e.target.checked })))}
              />
              전체 선택
            </label>
          </div>

          {importItems.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">불러올 필드가 없습니다</p>
          ) : (
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {importItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-700">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={e => {
                      const next = [...importItems]
                      next[i] = { ...item, checked: e.target.checked }
                      setImportItems(next)
                    }}
                  />
                  <span className="text-blue-300 font-mono text-xs flex-1 truncate">{item.key}</span>
                  {upstreamNode1 && (
                    <span className="text-xs text-slate-400 truncate" title={formatRowKeyInfo(item.key, upstreamNode1)}>
                      {formatRowKeyInfo(item.key, upstreamNode1)}
                    </span>
                  )}
                  <span className="text-slate-500 text-xs">→</span>
                  <input
                    type="text"
                    value={item.newKey}
                    onChange={e => {
                      const next = [...importItems]
                      next[i] = { ...item, newKey: e.target.value }
                      setImportItems(next)
                    }}
                    className="w-28 px-2 py-0.5 text-xs font-mono rounded bg-slate-600 border border-slate-500 text-green-300 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500">파란색: beforeKey (원본) · 초록색: newKey (출력, 수정 가능)</p>
          <div className="flex gap-2">
            <button onClick={confirmImport} className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white">
              선택 추가
            </button>
            <button onClick={() => setShowImport(false)} className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">
              취소
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {def.mappings.map((m, i) => (
          <div key={i} className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <div className="min-w-0 overflow-hidden flex items-center flex-wrap gap-x-1">
                <span className="text-green-300 font-mono truncate max-w-[120px]" title={m.newKey}>{m.newKey}</span>
                <span className="text-slate-500 shrink-0">&larr;</span>
                <span className="text-blue-300 font-mono truncate max-w-[120px]" title={m.beforeKey}>{m.beforeKey}</span>
                {upstreamNode1 && (
                  <span className="text-xs text-slate-400 truncate" title={formatRowKeyInfo(m.beforeKey, upstreamNode1)}>
                    {formatRowKeyInfo(m.beforeKey, upstreamNode1)}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditingMapping(m); setEditingIndex(i) }} className="text-slate-400 hover:text-white px-1">&#9999;&#65039;</button>
                <button onClick={() => onChange({ ...def, mappings: def.mappings.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-400 px-1">&#10005;</button>
              </div>
            </div>
            {m.filterCode && (
              <div className="mt-1 text-slate-400 font-mono truncate">filter: {m.filterCode}</div>
            )}
            {m.itemMappings && m.itemMappings.length > 0 && (
              <div className="mt-1 text-teal-400/70 font-mono truncate">
                {m.itemMappings.map(im => `${im.beforeKey}→${im.newKey}`).join(', ')}
              </div>
            )}
            {m.listAddItems && m.listAddItems.length > 0 && (
              <div className="mt-1 text-slate-400">
                +{m.listAddItems.length}개 원소 추가
              </div>
            )}
          </div>
        ))}
      </div>

      {editingIndex !== null && (
        <div className="p-3 rounded bg-slate-800 border border-blue-500 space-y-2">
          <InputField
            label="새 키 (newKey)"
            value={editingMapping.newKey}
            onChange={(e) => setEditingMapping({ ...editingMapping, newKey: e.target.value })}
            placeholder="예: orderId"
          />
          <InputField
            label="원본 키 (beforeKey)"
            value={editingMapping.beforeKey}
            onChange={(e) => setEditingMapping({ ...editingMapping, beforeKey: e.target.value })}
            placeholder="예: body.order_id 또는 body.items[0].id"
          />

          {/* Filter code + List add items — LIST 타입 필드에만 표시 */}
          {isEditingList && <>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">필터 코드 (리스트 전용, 선택)</label>
              <textarea
                value={editingMapping.filterCode ?? ''}
                onChange={(e) => setEditingMapping({ ...editingMapping, filterCode: e.target.value || undefined })}
                placeholder={'Map 원소: {$el.qty} > 3 && {$userId} == "abc"\n원시값 원소: {$el} > 10\n중첩 필드: {$el.info.tag} == "A"'}
                rows={2}
                className="w-full px-3 py-2 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              <CodeAiAssist
                nodeType="NODE3"
                codeType="FILTER_CODE"
                existingCode={editingMapping.filterCode ?? ''}
                unitId={unit.id}
                onApply={(code) => setEditingMapping({ ...editingMapping, filterCode: code || undefined })}
              />
              <p className="text-xs text-slate-500">
                Map 원소 필드는 <code className="text-slate-400">el.</code> 프리픽스로 접근 · 원시값 원소는 <code className="text-slate-400">el</code> · 외부 DTO 필드는 그대로 접근
                <br />
                <span className="text-amber-600">2차원 배열(리스트 안의 리스트) 원소는 필터/추가 대상에서 제외됩니다</span>
              </p>
            </div>

            {/* 아이템 필드 매핑 — LIST<CUSTOM> 전용 */}
            {editingListDtoFields && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-300">리스트 원소 필드 맵핑 (선택)</label>
                  <button
                    onClick={addItemMapping}
                    className="text-xs px-2 py-0.5 rounded bg-teal-700 hover:bg-teal-600 text-white"
                  >+ 필드</button>
                </div>
                {(editingMapping.itemMappings ?? []).length === 0 ? (
                  <p className="text-xs text-slate-600 py-1">각 원소의 필드 키를 변환합니다 (예: id → Id)</p>
                ) : (
                  <div className="space-y-1">
                    {(editingMapping.itemMappings ?? []).map((m, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <select
                          value={m.beforeKey}
                          onChange={e => updateItemMapping(idx, { ...m, beforeKey: e.target.value })}
                          className="w-32 text-xs rounded bg-slate-700 border border-slate-600 text-blue-300 px-1 py-0.5 focus:outline-none focus:border-teal-500"
                        >
                          <option value="">원본 키</option>
                          {editingListDtoFields.map(f => (
                            <option key={f.key} value={f.key}>{f.key}</option>
                          ))}
                        </select>
                        <span className="text-slate-500 text-xs">→</span>
                        <input
                          type="text"
                          value={m.newKey}
                          onChange={e => updateItemMapping(idx, { ...m, newKey: e.target.value })}
                          placeholder="새 키"
                          className="flex-1 min-w-0 px-2 py-0.5 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-green-300 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                        />
                        <button onClick={() => removeItemMapping(idx)} className="text-slate-500 hover:text-red-400 text-xs px-1 shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-300">리스트 원소 추가 (선택)</label>
                <button
                  onClick={appendAddItem}
                  className="text-xs px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-600 text-white"
                >
                  + 원소
                </button>
              </div>
              {(editingMapping.listAddItems ?? []).length === 0 ? (
                <p className="text-xs text-slate-600 py-1">필터 후 리스트 끝에 원소를 추가합니다</p>
              ) : (
                <div className="space-y-1">
                  {(editingMapping.listAddItems ?? []).map((item, idx) => (
                    <AddItemRow
                      key={idx}
                      item={item}
                      availableKeys={availableKeys}
                      generateTemplate={() => {
                        const node1 = findUpstreamNode1(currentNodeId, unit)
                        return node1 ? buildExprTemplate(editingMapping.beforeKey, node1) : '({\n  \n})'
                      }}
                      onChange={updated => updateAddItem(idx, updated)}
                      onRemove={() => removeAddItem(idx)}
                      listItemType={editingListItemType}
                      listItemDtoFields={editingListDtoFields}
                      unitId={unit.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </>}

          <div className="flex gap-2">
            <button onClick={saveMapping} className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white">저장</button>
            <button onClick={() => setEditingIndex(null)} className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
          </div>
        </div>
      )}

      {/* Output structure preview */}
      <FieldStructurePreview
        fields={previewFields}
        customDtos={[...(upstreamNode1?.customDtos ?? []), ...syntheticDtos]}
        rootName="Output"
      />
    </div>
  )
})

export default Node3Panel
