import { useState } from 'react'
import { Node2Definition, ValueReplaceRule, TypeConvertRule, CustomCodeRule, FieldType } from '../../types/workflow'
import { InputField, SelectField } from '../ui/FormField'

interface Props {
  definition: Node2Definition | undefined
  onChange: (def: Node2Definition) => void
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

export default function Node2Panel({ definition, onChange }: Props) {
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
        />
      )}
    </div>
  )
}

function ValueReplaceTab({ rules, onChange }: { rules: ValueReplaceRule[]; onChange: (r: ValueReplaceRule[]) => void }) {
  const [form, setForm] = useState<ValueReplaceRule>({ key: '', matchValue: '', afterValue: '' })
  const add = () => {
    if (!form.key) return
    onChange([...rules, form])
    setForm({ key: '', matchValue: '', afterValue: '' })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs">
            <span className="font-mono text-blue-300">{r.key}</span>
            <span className="text-slate-400">{r.matchValue} &rarr; {r.afterValue}</span>
            <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 ml-2">&#10005;</button>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
        <InputField label="키" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="예: header.name" />
        <InputField label="일치하는 값" value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} placeholder="변환 전 값" />
        <InputField label="변환할 값" value={form.afterValue} onChange={(e) => setForm({ ...form, afterValue: e.target.value })} placeholder="변환 후 값" />
        <button onClick={add} className="w-full py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white">+ 추가</button>
      </div>
    </div>
  )
}

function TypeConvertTab({ rules, onChange }: { rules: TypeConvertRule[]; onChange: (r: TypeConvertRule[]) => void }) {
  const [form, setForm] = useState<TypeConvertRule>({ key: '', beforeType: 'STRING', afterType: 'INT' })
  const add = () => {
    if (!form.key) return
    onChange([...rules, form])
    setForm({ key: '', beforeType: 'STRING', afterType: 'INT' })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs">
            <span className="font-mono text-blue-300">{r.key}</span>
            <span className="text-slate-400">{r.beforeType} &rarr; {r.afterType}</span>
            <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 ml-2">&#10005;</button>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
        <InputField label="키" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="예: header.time" />
        <SelectField label="변환 전 타입" value={form.beforeType} onChange={(e) => setForm({ ...form, beforeType: e.target.value as FieldType })} options={FIELD_TYPE_OPTIONS} />
        <SelectField label="변환 후 타입" value={form.afterType} onChange={(e) => setForm({ ...form, afterType: e.target.value as FieldType })} options={FIELD_TYPE_OPTIONS} />
        <button onClick={add} className="w-full py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white">+ 추가</button>
      </div>
    </div>
  )
}

function CustomCodeTab({ rules, onChange }: { rules: CustomCodeRule[]; onChange: (r: CustomCodeRule[]) => void }) {
  const [form, setForm] = useState<CustomCodeRule>({ key: '', code: '', afterType: undefined })
  const add = () => {
    if (!form.key || !form.code) return
    onChange([...rules, { ...form, afterType: form.afterType || undefined }])
    setForm({ key: '', code: '', afterType: undefined })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs">
            <div className="flex justify-between">
              <span className="font-mono text-blue-300">{r.key}</span>
              <div className="flex items-center gap-2">
                {r.afterType && <span className="text-green-400">→ {r.afterType}</span>}
                <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">✕</button>
              </div>
            </div>
            <code className="text-slate-300 text-xs break-all">{r.code}</code>
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3 rounded bg-slate-800 border border-slate-600">
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
        <button onClick={add} className="w-full py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white">+ 추가</button>
      </div>
    </div>
  )
}
