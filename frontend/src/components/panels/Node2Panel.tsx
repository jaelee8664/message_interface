import { useState } from 'react'
import { Node2Definition, ValueReplaceRule, TypeConvertRule, CustomCodeRule, FieldType } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'
import CodeAiAssist from '../llm/CodeAiAssist'
import { VariableExtractionSection } from '../ui/VariableExtractionSection'

interface Props {
  definition: Node2Definition | undefined
  onChange: (def: Node2Definition) => void
  unitId?: string
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
}

type Tab = 'replace' | 'typeConvert' | 'custom'

export default function Node2Panel({ definition, onChange, unitId }: Props) {
  const def = definition ?? DEFAULT_DEF
  const [tab, setTab] = useState<Tab>('replace')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'replace', label: '값 치환' },
    { id: 'typeConvert', label: '타입 변환' },
    { id: 'custom', label: '커스텀 코드' },
  ]

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 p-1 rounded">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1 text-xs rounded transition-colors ${
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
          <label className="block text-xs font-medium text-slate-300">코드 ({'{$key}'} 플레이스홀더 사용)</label>
          <textarea
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder={'예: {$header.time}.replace("-", ".")\n예2: ({$body.counts}.toDouble() + 0.0001) / 1000.0'}
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
