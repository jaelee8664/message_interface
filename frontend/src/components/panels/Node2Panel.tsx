import { useState } from 'react'
import { Node2Definition, ValueReplaceRule, TypeConvertRule, CustomCodeRule, ListItemCodeRule, ListItemFieldCodeRule, FieldType, WorkflowUnit, Node1Definition, FieldDefinition } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'
import CodeAiAssist from '../llm/CodeAiAssist'
import { VariableExtractionSection } from '../ui/VariableExtractionSection'

interface Props {
  definition: Node2Definition | undefined
  onChange: (def: Node2Definition) => void
  unitId?: string
  currentNodeId?: string
  unit?: WorkflowUnit
}

// ─── Upstream NODE1 utilities ─────────────────────────────────────────────────

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

function collectListFields(node1: Node1Definition): { path: string; label: string; elementFields: string[] }[] {
  const results: { path: string; label: string; elementFields: string[] }[] = []

  function expand(fields: FieldDefinition[], prefix: string) {
    for (const f of fields) {
      const path = prefix ? `${prefix}.${f.key}` : f.key
      if (f.type === 'LIST') {
        let label: string
        let elementFields: string[] = []
        if (f.listItemType === 'CUSTOM' && f.customTypeName) {
          label = `${f.customTypeName}[]`
          const dto = (node1.customDtos ?? []).find(d => d.name === f.customTypeName)
          elementFields = dto?.fields?.map(df => df.key) ?? []
        } else {
          label = `${f.listItemType ?? '?'}[]`
        }
        results.push({ path, label, elementFields })
      } else if (f.type === 'CUSTOM' && f.customTypeName) {
        const dto = (node1.customDtos ?? []).find(d => d.name === f.customTypeName)
        if (dto) expand(dto.fields ?? [], path)
      }
    }
  }

  expand(node1.fields ?? [], '')
  return results
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'STRING', label: 'String' },
  { value: 'INT', label: 'Int' },
  { value: 'DOUBLE', label: 'Double' },
  { value: 'BOOLEAN', label: 'Boolean' },
]

const DEFAULT_DEF: Node2Definition = {
  valueReplaceRules: [],
  typeConvertRules: [],
  customCodeRules: [],
  listItemCodeRules: [],
}

type Tab = 'replace' | 'typeConvert' | 'custom' | 'listItem'

export default function Node2Panel({ definition, onChange, unitId, currentNodeId, unit }: Props) {
  const def = definition ?? DEFAULT_DEF
  const [tab, setTab] = useState<Tab>('replace')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'replace', label: '값 치환' },
    { id: 'typeConvert', label: '타입 변환' },
    { id: 'custom', label: '커스텀 코드 - 맵' },
    { id: 'listItem', label: '커스텀 코드 - 리스트' },
  ]

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 p-1 rounded flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1 text-xs rounded transition-colors min-w-[60px] ${
              tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'replace' && (
        <ValueReplaceTab
          rules={def.valueReplaceRules}
          onChange={(rules) => onChange({ ...def, valueReplaceRules: rules })}
        />
      )}
      {tab === 'typeConvert' && (
        <TypeConvertTab
          rules={def.typeConvertRules}
          onChange={(rules) => onChange({ ...def, typeConvertRules: rules })}
        />
      )}
      {tab === 'custom' && (
        <CustomCodeTab
          rules={def.customCodeRules}
          onChange={(rules) => onChange({ ...def, customCodeRules: rules })}
          unitId={unitId}
        />
      )}
      {tab === 'listItem' && (
        <ListItemCodeTab
          rules={def.listItemCodeRules ?? []}
          onChange={(rules) => onChange({ ...def, listItemCodeRules: rules })}
          unitId={unitId}
          currentNodeId={currentNodeId}
          unit={unit}
        />
      )}

      {/* Variable extractions */}
      <div className="border-t border-slate-700 pt-3">
        <VariableExtractionSection
          extractions={def.variableExtractions ?? []}
          onChange={(extractions) => onChange({ ...def, variableExtractions: extractions })}
        />
      </div>
    </div>
  )
}

function ValueReplaceTab({ rules, onChange }: { rules: ValueReplaceRule[]; onChange: (r: ValueReplaceRule[]) => void }) {
  const EMPTY: ValueReplaceRule = { key: '', matchValue: '', afterValue: '' }
  const [form, setForm] = useState<ValueReplaceRule>(EMPTY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setForm({ ...rules[index] })
  }

  const cancel = () => {
    setEditingIndex(null)
    setForm(EMPTY)
  }

  const stripQuotes = (v: string) => v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v

  const save = () => {
    if (!form.key) return
    const sanitized = { ...form, matchValue: stripQuotes(form.matchValue), afterValue: stripQuotes(form.afterValue) }
    if (editingIndex !== null) {
      const updated = [...rules]
      updated[editingIndex] = sanitized
      onChange(updated)
      setEditingIndex(null)
    } else {
      onChange([...rules, sanitized])
    }
    setForm(EMPTY)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs ${editingIndex === i ? 'bg-blue-900 border-blue-500' : 'bg-slate-700 border-slate-600'}`}>
            <span className="font-mono text-blue-300">{r.key}</span>
            <span className="text-slate-400">{r.matchValue} &rarr; {r.afterValue}</span>
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => startEdit(i)} className="text-slate-400 hover:text-blue-300 px-1">&#9998;</button>
              <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">&#10005;</button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
        {editingIndex !== null && (
          <p className="text-xs text-blue-400 font-medium">수정 중 (#{editingIndex + 1})</p>
        )}
        <InputField label="키" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="예: header.name" />
        <InputField label="일치하는 값" value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} placeholder="변환 전 값 (따옴표 불필요)" />
        <InputField label="변환할 값" value={form.afterValue} onChange={(e) => setForm({ ...form, afterValue: e.target.value })} placeholder="변환 후 값 (따옴표 불필요)" />
        <div className="flex gap-2">
          {editingIndex !== null && (
            <button onClick={cancel} className="flex-1 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
          )}
          <button onClick={save} className={`py-1.5 text-xs rounded text-white ${editingIndex !== null ? 'flex-1 bg-green-600 hover:bg-green-700' : 'w-full bg-blue-600 hover:bg-blue-700'}`}>
            {editingIndex !== null ? '수정 저장' : '+ 추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TypeConvertTab({ rules, onChange }: { rules: TypeConvertRule[]; onChange: (r: TypeConvertRule[]) => void }) {
  const EMPTY: TypeConvertRule = { key: '', beforeType: 'STRING', afterType: 'INT' }
  const [form, setForm] = useState<TypeConvertRule>(EMPTY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setForm({ ...rules[index] })
  }

  const cancel = () => {
    setEditingIndex(null)
    setForm(EMPTY)
  }

  const save = () => {
    if (!form.key) return
    if (editingIndex !== null) {
      const updated = [...rules]
      updated[editingIndex] = form
      onChange(updated)
      setEditingIndex(null)
    } else {
      onChange([...rules, form])
    }
    setForm(EMPTY)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs ${editingIndex === i ? 'bg-blue-900 border-blue-500' : 'bg-slate-700 border-slate-600'}`}>
            <span className="font-mono text-blue-300">{r.key}</span>
            <span className="text-slate-400">{r.beforeType} &rarr; {r.afterType}</span>
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => startEdit(i)} className="text-slate-400 hover:text-blue-300 px-1">&#9998;</button>
              <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">&#10005;</button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
        {editingIndex !== null && (
          <p className="text-xs text-blue-400 font-medium">수정 중 (#{editingIndex + 1})</p>
        )}
        <InputField label="키" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="예: header.time" />
        <SelectField label="변환 전 타입" value={form.beforeType} onChange={(e) => setForm({ ...form, beforeType: e.target.value as FieldType })} options={FIELD_TYPE_OPTIONS} />
        <SelectField label="변환 후 타입" value={form.afterType} onChange={(e) => setForm({ ...form, afterType: e.target.value as FieldType })} options={FIELD_TYPE_OPTIONS} />
        <div className="flex gap-2">
          {editingIndex !== null && (
            <button onClick={cancel} className="flex-1 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
          )}
          <button onClick={save} className={`py-1.5 text-xs rounded text-white ${editingIndex !== null ? 'flex-1 bg-green-600 hover:bg-green-700' : 'w-full bg-blue-600 hover:bg-blue-700'}`}>
            {editingIndex !== null ? '수정 저장' : '+ 추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── List Item Code Tab ───────────────────────────────────────────────────────

function ListItemCodeTab({ rules, onChange, unitId, currentNodeId, unit }: {
  rules: ListItemCodeRule[]
  onChange: (r: ListItemCodeRule[]) => void
  unitId?: string
  currentNodeId?: string
  unit?: WorkflowUnit
}) {
  const [newListKey, setNewListKey] = useState('')

  const upstreamNode1 = unit && currentNodeId ? findUpstreamNode1(currentNodeId, unit) : null
  const detectedLists = upstreamNode1 ? collectListFields(upstreamNode1) : []

  const addListByKey = (key: string) => {
    const k = key.trim()
    if (!k || rules.some((r) => r.listKey === k)) return
    onChange([...rules, { listKey: k, fieldRules: [] }])
    setNewListKey('')
  }

  const removeList = (idx: number) => onChange(rules.filter((_, i) => i !== idx))

  const updateList = (idx: number, updated: ListItemCodeRule) => {
    const next = [...rules]
    next[idx] = updated
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="p-2.5 rounded bg-slate-800 border border-slate-700 space-y-1.5">
        <p className="text-xs text-slate-300 font-medium">리스트 원소마다 JavaScript 표현식으로 필드 값을 변환합니다.</p>
        <p className="text-xs text-slate-400">
          단일 표현식으로 작성하며 <code className="text-slate-300">return</code>은 사용하지 않습니다.
        </p>
        <div className="text-xs text-slate-400 space-y-0.5">
          <p><span className="font-mono text-yellow-300">{'{$el}'}</span> — 원시 타입 원소의 값 (String, Number 등)</p>
          <p><span className="font-mono text-yellow-300">{'{$el.필드명}'}</span> — Map 원소의 특정 필드 값</p>
          <p><span className="font-mono text-yellow-300">{'{$외부.키경로}'}</span> — 리스트 바깥의 메시지 필드 값</p>
        </div>
        <p className="text-xs text-slate-500">샌드박스: java.*, Packages.*, Java.type 사용 불가 · 타임아웃 3초</p>
      </div>

      {/* Auto-detected list fields */}
      {detectedLists.length > 0 && (
        <div className="p-2.5 rounded bg-slate-800 border border-slate-700 space-y-1.5">
          <p className="text-xs text-slate-400">감지된 리스트 필드</p>
          <div className="flex flex-wrap gap-1.5">
            {detectedLists.map(({ path, label }) => {
              const added = rules.some((r) => r.listKey === path)
              return (
                <button
                  key={path}
                  onClick={() => addListByKey(path)}
                  disabled={added}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded border font-mono transition-colors ${
                    added
                      ? 'border-slate-700 text-slate-600 cursor-default'
                      : 'border-blue-700 text-blue-300 hover:bg-blue-900/40 cursor-pointer'
                  }`}
                >
                  <span>{path}</span>
                  <span className={added ? 'text-slate-600' : 'text-slate-400'}>{label}</span>
                  {!added && <span className="text-green-400 font-sans">+</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {rules.map((rule, idx) => {
        const detected = detectedLists.find((d) => d.path === rule.listKey)
        return (
          <ListItemRuleCard
            key={rule.listKey}
            rule={rule}
            elementFields={detected?.elementFields ?? []}
            onUpdate={(updated) => updateList(idx, updated)}
            onDelete={() => removeList(idx)}
            unitId={unitId}
          />
        )
      })}

      {/* Manual input */}
      <div className="flex gap-2">
        <input
          value={newListKey}
          onChange={(e) => setNewListKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addListByKey(newListKey)}
          placeholder={detectedLists.length > 0 ? '직접 입력 (예: body.items)' : '리스트 경로 (예: body.items)'}
          className="flex-1 px-2 py-1.5 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <button onClick={() => addListByKey(newListKey)} className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap">
          + 추가
        </button>
      </div>
    </div>
  )
}

const EMPTY_FIELD_RULE: ListItemFieldCodeRule = { fieldKey: '', code: '', afterType: undefined }

function ListItemRuleCard({ rule, elementFields, onUpdate, onDelete, unitId }: {
  rule: ListItemCodeRule
  elementFields: string[]
  onUpdate: (updated: ListItemCodeRule) => void
  onDelete: () => void
  unitId?: string
}) {
  const [expanded, setExpanded] = useState(true)
  const [form, setForm] = useState<ListItemFieldCodeRule>(EMPTY_FIELD_RULE)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const saveField = () => {
    if (!form.code.trim()) return
    const sanitized = { ...form, afterType: form.afterType || undefined }
    if (editingIdx !== null) {
      const next = [...rule.fieldRules]
      next[editingIdx] = sanitized
      onUpdate({ ...rule, fieldRules: next })
      setEditingIdx(null)
    } else {
      onUpdate({ ...rule, fieldRules: [...rule.fieldRules, sanitized] })
    }
    setForm(EMPTY_FIELD_RULE)
  }

  const startEdit = (idx: number) => {
    setEditingIdx(idx)
    setForm({ ...rule.fieldRules[idx] })
  }

  const cancel = () => {
    setEditingIdx(null)
    setForm(EMPTY_FIELD_RULE)
  }

  const removeField = (idx: number) => {
    onUpdate({ ...rule, fieldRules: rule.fieldRules.filter((_, i) => i !== idx) })
    if (editingIdx === idx) { setEditingIdx(null); setForm(EMPTY_FIELD_RULE) }
  }

  return (
    <div className="rounded border border-slate-600 bg-slate-800">
      {/* Card header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-blue-300 text-xs truncate">{rule.listKey}</span>
          {elementFields.length > 0 && (
            <span className="text-xs text-slate-500 shrink-0">
              {elementFields.length}개 필드
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-slate-500">{rule.fieldRules.length}개 규칙</span>
          <button onClick={onDelete} className="text-slate-500 hover:text-red-400 text-xs px-1">✕</button>
          <span className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700 p-3 space-y-3">
          {/* Field rules list */}
          {rule.fieldRules.length > 0 && (
            <div className="space-y-1.5">
              {rule.fieldRules.map((fr, i) => (
                <div
                  key={i}
                  className={`px-2 py-1.5 rounded border text-xs ${editingIdx === i ? 'bg-blue-900 border-blue-500' : 'bg-slate-700 border-slate-600'}`}
                >
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="font-mono text-yellow-300">{fr.fieldKey || '(el)'}</span>
                    <div className="flex items-center gap-1.5">
                      {fr.afterType && <span className="text-green-400">→ {fr.afterType}</span>}
                      <button onClick={() => startEdit(i)} className="text-slate-400 hover:text-blue-300 px-0.5">✏</button>
                      <button onClick={() => removeField(i)} className="text-slate-500 hover:text-red-400">✕</button>
                    </div>
                  </div>
                  <code className="text-slate-300 break-all">{fr.code}</code>
                </div>
              ))}
            </div>
          )}

          {/* Add / edit form */}
          <div className="space-y-2 p-2 rounded bg-slate-900 border border-slate-700">
            {editingIdx !== null && (
              <p className="text-xs text-blue-400 font-medium">수정 중 (#{editingIdx + 1})</p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                필드 키{' '}
                <span className="text-slate-500 font-normal">
                  (Map 원소: 필드명, 원시 타입: 비워두기)
                </span>
              </label>
              <input
                value={form.fieldKey}
                onChange={(e) => setForm({ ...form, fieldKey: e.target.value })}
                placeholder="예: id, product_name  (원시 타입이면 비워두기)"
                className="w-full px-2 py-1.5 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              {elementFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {elementFields.map((ef) => (
                    <button
                      key={ef}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, fieldKey: ef }))}
                      className={`px-1.5 py-0.5 text-xs rounded font-mono transition-colors ${
                        form.fieldKey === ef
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-600 hover:bg-slate-500 text-slate-300'
                      }`}
                    >
                      {ef}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                코드
              </label>
              <textarea
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder={`Map 원소: {$el.id}.replaceAll('-', '.') + {$el.product_name}\n외부 참조: parseFloat({$header.user_id})\n원시 타입: {$el} + 1`}
                rows={3}
                className="w-full px-2 py-1.5 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              <CodeAiAssist
                nodeType="NODE2"
                codeType="LIST_ITEM_CODE"
                existingCode={form.code}
                unitId={unitId}
                fieldKey={form.fieldKey || undefined}
                onApply={(code) => setForm((f) => ({ ...f, code }))}
              />
            </div>
            <SelectField
              label="결과 타입 변환 (선택)"
              value={form.afterType ?? ''}
              onChange={(e) => setForm({ ...form, afterType: (e.target.value as FieldType) || undefined })}
              options={[
                { value: '', label: '변환 없음' },
                { value: 'STRING', label: 'String' },
                { value: 'INT', label: 'Int' },
                { value: 'DOUBLE', label: 'Double' },
                { value: 'BOOLEAN', label: 'Boolean' },
              ]}
            />
            <div className="flex gap-2">
              {editingIdx !== null && (
                <button onClick={cancel} className="flex-1 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
              )}
              <button
                onClick={saveField}
                className={`py-1.5 text-xs rounded text-white ${editingIdx !== null ? 'flex-1 bg-green-600 hover:bg-green-700' : 'w-full bg-blue-600 hover:bg-blue-700'}`}
              >
                {editingIdx !== null ? '수정 저장' : '+ 필드 규칙 추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Custom Code Tab ──────────────────────────────────────────────────────────

function CustomCodeTab({ rules, onChange, unitId }: { rules: CustomCodeRule[]; onChange: (r: CustomCodeRule[]) => void; unitId?: string }) {
  const EMPTY: CustomCodeRule = { key: '', code: '', afterType: undefined }
  const [form, setForm] = useState<CustomCodeRule>(EMPTY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setForm({ ...rules[index] })
  }

  const cancel = () => {
    setEditingIndex(null)
    setForm(EMPTY)
  }

  const save = () => {
    if (!form.key || !form.code) return
    if (editingIndex !== null) {
      const updated = [...rules]
      updated[editingIndex] = { ...form, afterType: form.afterType || undefined }
      onChange(updated)
      setEditingIndex(null)
    } else {
      onChange([...rules, { ...form, afterType: form.afterType || undefined }])
    }
    setForm(EMPTY)
  }

  return (
    <div className="space-y-3">
      {/* Description */}
      <div className="p-2.5 rounded bg-slate-800 border border-slate-700 space-y-1.5">
        <p className="text-xs text-slate-300 font-medium">JavaScript 표현식으로 필드 값을 변환합니다.</p>
        <p className="text-xs text-slate-400">
          <span className="font-mono text-yellow-300">{'{$키경로}'}</span>는 해당 필드의 실제 값으로 치환됩니다.
          단일 표현식으로 작성하며 <code className="text-slate-300">return</code>은 사용하지 않습니다.
        </p>
        <p className="text-xs text-slate-500">샌드박스: java.*, Packages.*, Java.type 사용 불가 · 타임아웃 3초</p>
      </div>

      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className={`px-2 py-1.5 rounded border text-xs ${editingIndex === i ? 'bg-blue-900 border-blue-500' : 'bg-slate-700 border-slate-600'}`}>
            <div className="flex justify-between">
              <span className="font-mono text-blue-300">{r.key}</span>
              <div className="flex items-center gap-2">
                {r.afterType && <span className="text-green-400">→ {r.afterType}</span>}
                <button onClick={() => startEdit(i)} className="text-slate-400 hover:text-blue-300 px-1">&#9998;</button>
                <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">✕</button>
              </div>
            </div>
            <code className="text-slate-300 text-xs break-all">{r.code}</code>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
        {editingIndex !== null && (
          <p className="text-xs text-blue-400 font-medium">수정 중 (#{editingIndex + 1})</p>
        )}
        <InputField label="키" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="예: header.time" />
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">JS 표현식</label>
          <textarea
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder={'예: {$header.time}.replace("-", ".")\n예2: (Number({$body.counts}) + 0.0001) / 1000.0\n예3: {$header.name}.toUpperCase()'}
            rows={3}
            className="w-full px-3 py-2 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <CodeAiAssist
            nodeType="NODE2"
            codeType="CUSTOM_CODE"
            existingCode={form.code}
            unitId={unitId}
            fieldKey={form.key || undefined}
            onApply={(code) => setForm((f) => ({ ...f, code }))}
          />
        </div>
        <SelectField
          label="결과 타입 변환 (선택)"
          value={form.afterType ?? ''}
          onChange={(e) => setForm({ ...form, afterType: (e.target.value as FieldType) || undefined })}
          options={[
            { value: '', label: '변환 없음 (String 유지)' },
            { value: 'STRING', label: 'String' },
            { value: 'INT', label: 'Int' },
            { value: 'DOUBLE', label: 'Double' },
            { value: 'BOOLEAN', label: 'Boolean' },
          ]}
          hint="코드 실행 결과를 이 타입으로 변환합니다. 단위 변환 시 사용하세요."
        />
        <div className="flex gap-2">
          {editingIndex !== null && (
            <button onClick={cancel} className="flex-1 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
          )}
          <button onClick={save} className={`py-1.5 text-xs rounded text-white ${editingIndex !== null ? 'flex-1 bg-green-600 hover:bg-green-700' : 'w-full bg-blue-600 hover:bg-blue-700'}`}>
            {editingIndex !== null ? '수정 저장' : '+ 추가'}
          </button>
        </div>
      </div>
    </div>
  )
}
