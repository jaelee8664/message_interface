import { useState } from 'react'
import { ProtoFieldDef, ProtoFieldType, ProtoFieldLabel, ProtoMessageDef } from '../../types/workflow'

// ── 상수 ──────────────────────────────────────────────────────────────────────

const PROTO_TYPE_OPTIONS: { value: ProtoFieldType; label: string }[] = [
  { value: 'STRING',  label: 'string'  },
  { value: 'INT32',   label: 'int32'   },
  { value: 'INT64',   label: 'int64'   },
  { value: 'UINT32',  label: 'uint32'  },
  { value: 'UINT64',  label: 'uint64'  },
  { value: 'SINT32',  label: 'sint32'  },
  { value: 'SINT64',  label: 'sint64'  },
  { value: 'FLOAT',   label: 'float'   },
  { value: 'DOUBLE',  label: 'double'  },
  { value: 'BOOL',    label: 'bool'    },
  { value: 'BYTES',   label: 'bytes'   },
]

const EMPTY_FIELD: ProtoFieldDef = { number: 1, name: '', type: 'STRING', label: 'OPTIONAL' }

// ── Proto3 텍스트 클라이언트사이드 파싱 ───────────────────────────────────────

const PROTO3_TYPE_MAP: Partial<Record<string, ProtoFieldType>> = {
  string: 'STRING', int32: 'INT32', int64: 'INT64',
  uint32: 'UINT32', uint64: 'UINT64', sint32: 'SINT32', sint64: 'SINT64',
  float: 'FLOAT', double: 'DOUBLE', bool: 'BOOL', bytes: 'BYTES',
}

function parseProto3Sample(text: string): { fields: ProtoFieldDef[]; messages: ProtoMessageDef[] } {
  const messages: ProtoMessageDef[] = []

  // 모든 message 블록 파싱
  const messageRegex = /message\s+(\w+)\s*\{([^}]*)\}/g
  let rootFields: ProtoFieldDef[] = []
  let firstMessage = true

  let m: RegExpExecArray | null
  while ((m = messageRegex.exec(text)) !== null) {
    const msgName = m[1]
    const body = m[2]
    const fields: ProtoFieldDef[] = []
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) continue
      const fm = trimmed.match(/^(repeated\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)\s*;/)
      if (!fm) continue
      const [, repeated, typeName, fieldName, numStr] = fm
      const type = PROTO3_TYPE_MAP[typeName]
      if (type) {
        fields.push({ number: parseInt(numStr, 10), name: fieldName, type, label: repeated ? 'REPEATED' : 'OPTIONAL' })
      } else {
        // message 타입 참조
        fields.push({ number: parseInt(numStr, 10), name: fieldName, type: 'STRING', label: repeated ? 'REPEATED' : 'OPTIONAL', messageTypeName: typeName })
      }
    }
    if (firstMessage) {
      rootFields = fields
      firstMessage = false
    } else {
      messages.push({ name: msgName, fields })
    }
  }

  if (!rootFields.length) throw new Error('필드를 추출하지 못했습니다. proto3 형식을 확인해주세요.')
  return { fields: rootFields, messages }
}

// ── 샘플 자동 추론 섹션 ────────────────────────────────────────────────────────

type InferFormat = 'JSON' | 'XML' | 'PROTO'

interface SampleInferProps {
  hasExisting: boolean
  onApply: (fields: ProtoFieldDef[], messages: ProtoMessageDef[], mode: 'replace' | 'append') => void
}

function SampleInferSection({ hasExisting, onApply }: SampleInferProps) {
  const [open, setOpen]         = useState(false)
  const [format, setFormat]     = useState<InferFormat>('JSON')
  const [sample, setSample]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleInfer = async (mode: 'replace' | 'append') => {
    if (!sample.trim()) return
    setError(null)

    // PROTO: 클라이언트사이드 파싱
    if (format === 'PROTO') {
      try {
        const { fields, messages } = parseProto3Sample(sample.trim())
        onApply(fields, messages, mode)
        setSample('')
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '파싱 실패')
      }
      return
    }

    // JSON / XML: 백엔드 추론
    setLoading(true)
    try {
      const res = await fetch('/synapse/api/proto/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, sample: sample.trim() }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || `HTTP ${res.status}`)
      }
      const data = await res.json() as { fields: ProtoFieldDef[]; messages: ProtoMessageDef[] }
      if (!data.fields?.length) throw new Error('필드를 추출하지 못했습니다.')
      onApply(data.fields, data.messages ?? [], mode)
      setSample('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '추론 실패')
    } finally {
      setLoading(false)
    }
  }

  const placeholder: Record<InferFormat, string> = {
    JSON: '{\n  "header": {\n    "userId": "abc",\n    "traceId": "xyz"\n  },\n  "body": {\n    "amount": 100,\n    "active": true\n  }\n}',
    XML:  '<message>\n  <header>\n    <userId>abc</userId>\n  </header>\n  <body>\n    <amount>100</amount>\n  </body>\n</message>',
    PROTO: 'message Header {\n  string user_id = 1;\n  string trace_id = 2;\n}\nmessage Message {\n  Header header = 1;\n  int32 amount = 2;\n}',
  }

  const hint: Record<InferFormat, string> = {
    JSON:  'JSON 샘플 → 중첩 객체를 별도 MESSAGE 타입으로 자동 추론합니다.',
    XML:   'XML 샘플 → 중첩 엘리먼트를 별도 MESSAGE 타입으로 자동 추론합니다.',
    PROTO: 'proto3 스키마 텍스트 → 첫 번째 message 를 루트로, 나머지는 중첩 메시지로 가져옵니다.',
  }

  return (
    <div className="rounded border border-dashed border-slate-600 bg-slate-800/30">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 rounded"
      >
        <span className="font-medium">샘플에서 자동 생성</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-2">
          <div className="flex gap-2">
            {(['JSON', 'XML', 'PROTO'] as InferFormat[]).map(f => (
              <button
                key={f}
                onClick={() => { setFormat(f); setSample(''); setError(null) }}
                className={`px-2 py-0.5 text-xs rounded ${
                  format === f
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500">{hint[format]}</div>
          <textarea
            value={sample}
            onChange={e => { setSample(e.target.value); setError(null) }}
            placeholder={placeholder[format]}
            className="w-full h-28 px-2 py-1.5 text-xs font-mono rounded bg-slate-900 border border-slate-600 text-slate-300 resize-y focus:outline-none focus:border-cyan-500"
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => handleInfer(hasExisting ? 'append' : 'replace')}
              disabled={!sample.trim() || loading}
              className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40"
            >
              {loading ? '추론 중…' : hasExisting ? '+ 추가' : '자동 생성'}
            </button>
            {hasExisting && (
              <button
                onClick={() => handleInfer('replace')}
                disabled={!sample.trim() || loading}
                className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40"
              >
                교체
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 필드 행 ────────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: ProtoFieldDef
  index: number
  total: number
  allMessageNames: string[]
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onRemove: () => void
}

function ProtoFieldRow({ field, index, total, onMoveUp, onMoveDown, onEdit, onRemove }: FieldRowProps) {
  const typeLabel = field.messageTypeName
    ? <span className="text-emerald-300 font-mono shrink-0">{field.messageTypeName}</span>
    : <span className="text-violet-300 font-mono shrink-0">{field.type.toLowerCase()}</span>

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs group">
      <span className="w-6 text-center text-slate-500 font-mono shrink-0">{field.number}</span>
      <span className="text-cyan-300 font-mono flex-1 min-w-0 truncate">{field.name || <span className="text-slate-500 italic">이름 없음</span>}</span>
      {typeLabel}
      {field.label === 'REPEATED' && (
        <span className="text-amber-400 text-xs shrink-0">repeated</span>
      )}
      <div className="flex gap-0.5 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onMoveUp}   disabled={index === 0}         className="text-slate-400 hover:text-white disabled:opacity-20 px-0.5" title="위로">▲</button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="text-slate-400 hover:text-white disabled:opacity-20 px-0.5" title="아래로">▼</button>
        <button onClick={onEdit}   className="text-slate-400 hover:text-white px-0.5">✎</button>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-400 px-0.5">✕</button>
      </div>
    </div>
  )
}

// ── 필드 편집기 ────────────────────────────────────────────────────────────────

interface FieldEditorProps {
  field: ProtoFieldDef
  messageNames: string[]
  onChange: (f: ProtoFieldDef) => void
  onSave: () => void
  onCancel: () => void
}

function ProtoFieldEditor({ field, messageNames, onChange, onSave, onCancel }: FieldEditorProps) {
  const isMessage = !!field.messageTypeName
  const isValid   = field.name.trim() !== '' && field.number > 0 && (isMessage ? !!field.messageTypeName : true)

  return (
    <div className="mt-2 p-3 rounded bg-slate-800 border border-cyan-500 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">필드 번호</label>
          <input
            type="number" min={1}
            value={field.number}
            onChange={e => onChange({ ...field, number: Math.max(1, Number(e.target.value)) })}
            className="w-full px-2 py-1.5 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">타입</label>
          <select
            value={isMessage ? '__MESSAGE__' : field.type}
            onChange={e => {
              if (e.target.value === '__MESSAGE__') {
                onChange({ ...field, messageTypeName: messageNames[0] ?? '', type: 'STRING' })
              } else {
                onChange({ ...field, type: e.target.value as ProtoFieldType, messageTypeName: undefined })
              }
            }}
            className="w-full px-2 py-1.5 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-cyan-500"
          >
            {PROTO_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {messageNames.length > 0 && <option value="__MESSAGE__">message (중첩)</option>}
          </select>
        </div>
      </div>

      {/* MESSAGE 타입일 때 메시지 이름 선택 */}
      {isMessage && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">메시지 타입</label>
          <select
            value={field.messageTypeName ?? ''}
            onChange={e => onChange({ ...field, messageTypeName: e.target.value })}
            className="w-full px-2 py-1.5 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="">-- 선택 --</option>
            {messageNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">이름</label>
        <input
          type="text" value={field.name}
          onChange={e => onChange({ ...field, name: e.target.value })}
          placeholder="예: user_id"
          className="w-full px-2 py-1.5 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-cyan-500 font-mono"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">레이블</label>
        <div className="flex gap-3">
          {(['OPTIONAL', 'REPEATED'] as ProtoFieldLabel[]).map(lbl => (
            <label key={lbl} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={field.label === lbl} onChange={() => onChange({ ...field, label: lbl })} className="accent-cyan-500" />
              <span className="text-xs text-slate-300">{lbl.toLowerCase()}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={!isValid} className="px-3 py-1.5 text-xs rounded bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-40">저장</button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
      </div>
    </div>
  )
}

// ── 중첩 메시지 정의 섹션 ──────────────────────────────────────────────────────

interface NestedMessagesSectionProps {
  messages: ProtoMessageDef[]
  onChange: (messages: ProtoMessageDef[]) => void
}

function NestedMessagesSection({ messages, onChange }: NestedMessagesSectionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [addingName, setAddingName]       = useState('')
  const [isAdding, setIsAdding]           = useState(false)

  // 각 메시지별 편집 상태
  const [editingFieldIdx, setEditingFieldIdx]   = useState<Record<number, number | null>>({})
  const [editingFieldVal, setEditingFieldVal]   = useState<Record<number, ProtoFieldDef>>({})

  const addMessage = () => {
    const name = addingName.trim()
    if (!name || messages.some(m => m.name === name)) return
    onChange([...messages, { name, fields: [] }])
    setAddingName('')
    setIsAdding(false)
    setExpandedIndex(messages.length)
  }

  const removeMessage = (i: number) => {
    onChange(messages.filter((_, idx) => idx !== i))
    if (expandedIndex === i) setExpandedIndex(null)
  }

  const renameMessage = (i: number, name: string) => {
    onChange(messages.map((m, idx) => idx === i ? { ...m, name } : m))
  }

  const updateFields = (i: number, fields: ProtoFieldDef[]) => {
    onChange(messages.map((m, idx) => idx === i ? { ...m, fields } : m))
  }

  const startAddField = (mi: number) => {
    const nextNum = messages[mi].fields.length > 0
      ? Math.max(...messages[mi].fields.map(f => f.number)) + 1 : 1
    setEditingFieldIdx({ ...editingFieldIdx, [mi]: messages[mi].fields.length })
    setEditingFieldVal({ ...editingFieldVal, [mi]: { ...EMPTY_FIELD, number: nextNum } })
  }

  const startEditField = (mi: number, fi: number) => {
    setEditingFieldIdx({ ...editingFieldIdx, [mi]: fi })
    setEditingFieldVal({ ...editingFieldVal, [mi]: { ...messages[mi].fields[fi] } })
  }

  const saveField = (mi: number) => {
    const fi = editingFieldIdx[mi]
    const ef = editingFieldVal[mi]
    if (fi == null || !ef?.name.trim()) return
    const hasDup = messages[mi].fields.some((f, i) => i !== fi && f.number === ef.number)
    if (hasDup) return
    const fields = [...messages[mi].fields]
    fields[fi] = ef
    updateFields(mi, fields)
    setEditingFieldIdx({ ...editingFieldIdx, [mi]: null })
  }

  const cancelField = (mi: number) => {
    setEditingFieldIdx({ ...editingFieldIdx, [mi]: null })
  }

  const removeField = (mi: number, fi: number) => {
    updateFields(mi, messages[mi].fields.filter((_, i) => i !== fi))
    if (editingFieldIdx[mi] === fi) setEditingFieldIdx({ ...editingFieldIdx, [mi]: null })
  }

  const moveField = (mi: number, from: number, to: number) => {
    if (to < 0 || to >= messages[mi].fields.length) return
    const fields = [...messages[mi].fields]
    const [item] = fields.splice(from, 1)
    fields.splice(to, 0, item)
    updateFields(mi, fields.map((f, i) => ({ ...f, number: i + 1 })))
  }

  // 다른 메시지 이름들 (자기 자신 제외)
  const otherMessageNames = (selfIdx: number) => messages.filter((_, i) => i !== selfIdx).map(m => m.name)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">중첩 메시지 정의</span>
        <button
          onClick={() => setIsAdding(true)}
          className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
        >
          + 메시지 추가
        </button>
      </div>

      <div className="text-xs text-slate-500">
        루트 필드에서 <span className="text-emerald-300 font-mono">message</span> 타입으로 참조할 중첩 메시지를 정의하세요.
      </div>

      {isAdding && (
        <div className="p-2 rounded border border-emerald-600 bg-slate-800 flex gap-2 items-center">
          <input
            type="text" autoFocus value={addingName}
            onChange={e => setAddingName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMessage() }}
            placeholder="예: Header"
            className="flex-1 px-2 py-1 text-xs rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500 font-mono"
          />
          <button onClick={addMessage} disabled={!addingName.trim()} className="px-2 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40">추가</button>
          <button onClick={() => { setIsAdding(false); setAddingName('') }} className="px-2 py-1 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white">취소</button>
        </div>
      )}

      {messages.map((msg, mi) => {
        const isExpanded = expandedIndex === mi
        const fi = editingFieldIdx[mi] ?? null
        const ef = editingFieldVal[mi]

        return (
          <div key={mi} className="rounded border border-slate-600 bg-slate-800/50">
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-700/50 rounded-t"
              onClick={() => setExpandedIndex(isExpanded ? null : mi)}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 select-none">{isExpanded ? '▼' : '▶'}</span>
                <span className="text-sm font-semibold text-emerald-300 font-mono">{msg.name}</span>
                <span className="text-xs text-slate-500">({msg.fields.length}개 필드)</span>
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeMessage(mi) }}
                className="text-slate-500 hover:text-red-400 text-xs px-1"
              >
                삭제
              </button>
            </div>

            {isExpanded && (
              <div className="px-3 pb-3 border-t border-slate-700 pt-2 space-y-2">
                {/* 이름 변경 */}
                <input
                  type="text" value={msg.name}
                  onChange={e => renameMessage(mi, e.target.value)}
                  className="w-full px-2 py-1 text-xs font-mono rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                  placeholder="메시지 이름"
                />

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">필드</span>
                  <button
                    onClick={() => startAddField(mi)}
                    className="text-xs px-2 py-0.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white"
                  >
                    + 필드 추가
                  </button>
                </div>

                <div className="space-y-1">
                  {msg.fields.map((f, fIdx) => (
                    <div key={fIdx}>
                      <ProtoFieldRow
                        field={f} index={fIdx} total={msg.fields.length}
                        allMessageNames={otherMessageNames(mi)}
                        onMoveUp={() => moveField(mi, fIdx, fIdx - 1)}
                        onMoveDown={() => moveField(mi, fIdx, fIdx + 1)}
                        onEdit={() => startEditField(mi, fIdx)}
                        onRemove={() => removeField(mi, fIdx)}
                      />
                      {fi === fIdx && ef && (
                        <ProtoFieldEditor
                          field={ef}
                          messageNames={otherMessageNames(mi)}
                          onChange={v => setEditingFieldVal({ ...editingFieldVal, [mi]: v })}
                          onSave={() => saveField(mi)}
                          onCancel={() => cancelField(mi)}
                        />
                      )}
                    </div>
                  ))}
                  {msg.fields.length === 0 && fi === null && (
                    <div className="text-xs text-slate-600 italic px-2 py-1">아직 필드가 없습니다.</div>
                  )}
                  {fi === msg.fields.length && ef && (
                    <ProtoFieldEditor
                      field={ef}
                      messageNames={otherMessageNames(mi)}
                      onChange={v => setEditingFieldVal({ ...editingFieldVal, [mi]: v })}
                      onSave={() => saveField(mi)}
                      onCancel={() => cancelField(mi)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {messages.length === 0 && !isAdding && (
        <div className="text-xs text-slate-600 italic px-1">정의된 중첩 메시지가 없습니다.</div>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

interface Props {
  fields: ProtoFieldDef[]
  messages: ProtoMessageDef[]
  onChange: (fields: ProtoFieldDef[], messages: ProtoMessageDef[]) => void
}

export default function ProtoSchemaEditor({ fields, messages, onChange }: Props) {
  const [editingIndex, setEditingIndex]   = useState<number | null>(null)
  const [editingField, setEditingField]   = useState<ProtoFieldDef>(EMPTY_FIELD)

  const messageNames = messages.map(m => m.name)

  const nextNumber = fields.length > 0
    ? Math.max(...fields.map(f => f.number)) + 1
    : 1

  const startAdd = () => {
    setEditingField({ ...EMPTY_FIELD, number: nextNumber })
    setEditingIndex(fields.length)
  }

  const startEdit = (i: number) => {
    setEditingField({ ...fields[i] })
    setEditingIndex(i)
  }

  const saveField = () => {
    if (editingIndex === null || !editingField.name.trim()) return
    const updated = [...fields]
    updated[editingIndex] = editingField
    const hasDuplicate = updated.some((f, i) => i !== editingIndex && f.number === editingField.number)
    if (hasDuplicate) return
    onChange(updated, messages)
    setEditingIndex(null)
  }

  const removeField = (i: number) => {
    onChange(fields.filter((_, idx) => idx !== i), messages)
    if (editingIndex === i) setEditingIndex(null)
  }

  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return
    const updated = [...fields]
    const [item] = updated.splice(from, 1)
    updated.splice(to, 0, item)
    onChange(updated.map((f, i) => ({ ...f, number: i + 1 })), messages)
  }

  const handleSampleApply = (
    incoming: ProtoFieldDef[],
    incomingMessages: ProtoMessageDef[],
    mode: 'replace' | 'append',
  ) => {
    if (mode === 'replace') {
      onChange(incoming, incomingMessages)
    } else {
      const existingNames    = new Set(fields.map(f => f.name))
      const existingMsgNames = new Set(messages.map(m => m.name))
      const base = fields.length > 0 ? Math.max(...fields.map(f => f.number)) : 0
      const toAdd = incoming.filter(f => !existingNames.has(f.name))
      onChange(
        [...fields, ...toAdd.map((f, i) => ({ ...f, number: base + i + 1 }))],
        [...messages, ...incomingMessages.filter(m => !existingMsgNames.has(m.name))],
      )
    }
    setEditingIndex(null)
  }

  const numberCounts = fields.reduce<Record<number, number>>((acc, f) => {
    acc[f.number] = (acc[f.number] ?? 0) + 1
    return acc
  }, {})
  const hasDuplicateNumbers = Object.values(numberCounts).some(c => c > 1)

  return (
    <div className="space-y-4">
      {/* ── 루트 필드 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">Proto 필드 정의 (루트)</span>
          <button onClick={startAdd} className="text-xs px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white">
            + 필드 추가
          </button>
        </div>

        <SampleInferSection hasExisting={fields.length > 0} onApply={handleSampleApply} />

        {hasDuplicateNumbers && (
          <div className="p-2 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-400">
            중복된 필드 번호가 있습니다. proto 스키마에서 필드 번호는 고유해야 합니다.
          </div>
        )}

        {fields.length > 0 && (
          <div className="flex items-center gap-1 px-2 text-xs text-slate-500 font-medium">
            <span className="w-6 text-center shrink-0">#</span>
            <span className="flex-1">이름</span>
            <span className="shrink-0 mr-12">타입</span>
          </div>
        )}

        <div className="space-y-1">
          {fields.map((f, i) => (
            <div key={i}>
              <ProtoFieldRow
                field={f} index={i} total={fields.length}
                allMessageNames={messageNames}
                onMoveUp={() => moveField(i, i - 1)}
                onMoveDown={() => moveField(i, i + 1)}
                onEdit={() => startEdit(i)}
                onRemove={() => removeField(i)}
              />
              {editingIndex === i && (
                <ProtoFieldEditor
                  field={editingField}
                  messageNames={messageNames}
                  onChange={setEditingField}
                  onSave={saveField}
                  onCancel={() => setEditingIndex(null)}
                />
              )}
            </div>
          ))}

          {editingIndex === fields.length && (
            <ProtoFieldEditor
              field={editingField}
              messageNames={messageNames}
              onChange={setEditingField}
              onSave={saveField}
              onCancel={() => setEditingIndex(null)}
            />
          )}

          {fields.length === 0 && editingIndex === null && (
            <div className="text-xs text-slate-600 italic px-2 py-2">
              아직 필드가 없습니다. "+ 필드 추가" 또는 "샘플에서 자동 생성"을 사용하세요.
            </div>
          )}
        </div>

        {/* proto3 미리보기 */}
        {(fields.length > 0 || messages.length > 0) && (
          <div className="mt-2">
            <div className="text-xs text-slate-500 mb-1">proto3 미리보기</div>
            <pre className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
              {[
                ...messages.map(m =>
                  `message ${m.name} {\n${
                    m.fields.slice().sort((a, b) => a.number - b.number)
                      .map(f => `  ${f.label === 'REPEATED' ? 'repeated ' : ''}${f.messageTypeName ?? f.type.toLowerCase()} ${f.name || '??'} = ${f.number};`)
                      .join('\n')
                  }\n}`
                ),
                `message Message {\n${
                  fields.slice().sort((a, b) => a.number - b.number)
                    .map(f => `  ${f.label === 'REPEATED' ? 'repeated ' : ''}${f.messageTypeName ?? f.type.toLowerCase()} ${f.name || '??'} = ${f.number};`)
                    .join('\n')
                }\n}`,
              ].join('\n\n')}
            </pre>
          </div>
        )}
      </div>

      {/* 구분선 */}
      <div className="border-t border-slate-700" />

      {/* ── 중첩 메시지 정의 ── */}
      <NestedMessagesSection
        messages={messages}
        onChange={msgs => onChange(fields, msgs)}
      />
    </div>
  )
}
