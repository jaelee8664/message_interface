import { useState } from 'react'
import { Node1Definition, FieldDefinition, FieldType, MessageFormat, ProtoFieldDef, ProtoMessageDef } from '../../types/workflow'
import { SelectField, CheckboxField, InputField } from '../ui/FormField'
import FieldStructurePreview from '../ui/FieldStructurePreview'
import ProtoSchemaEditor from './ProtoSchemaEditor'

// ── Sample parser helpers ──────────────────────────────────────────────────────

interface ParseResult {
  fields: FieldDefinition[]
  customDtos: Array<{ name: string; fields: FieldDefinition[] }>
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function uniqueDtoName(base: string, existing: Array<{ name: string }>, used: Set<string>): string {
  let name = base
  let i = 2
  while (existing.some((d) => d.name === name) || used.has(name)) name = `${base}${i++}`
  used.add(name)
  return name
}

// JSON
function inferJsonType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'string') return 'STRING'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INT' : 'DOUBLE'
  if (Array.isArray(value)) return 'LIST'
  if (value !== null && typeof value === 'object') return 'CUSTOM'
  return 'STRING'
}

function walkJson(
  obj: Record<string, unknown>,
  dtos: Array<{ name: string; fields: FieldDefinition[] }>,
  used: Set<string>,
): FieldDefinition[] {
  return Object.entries(obj).map(([key, value]): FieldDefinition => {
    const base: FieldDefinition = { key, type: 'STRING', nullable: value === null, mandatory: true, description: key }
    if (value === null) return { ...base, type: 'STRING', nullable: true }
    const t = inferJsonType(value)
    if (t === 'CUSTOM') {
      const dtoName = uniqueDtoName(toPascalCase(key), dtos, used)
      dtos.push({ name: dtoName, fields: walkJson(value as Record<string, unknown>, dtos, used) })
      return { ...base, type: 'CUSTOM', customTypeName: dtoName }
    }
    if (t === 'LIST') {
      const first = (value as unknown[]).find((v) => v !== null)
      if (first === undefined) return { ...base, type: 'LIST', listItemType: 'STRING' }
      const itemType = inferJsonType(first)
      if (itemType === 'CUSTOM') {
        const dtoName = uniqueDtoName(toPascalCase(key) + 'Item', dtos, used)
        dtos.push({ name: dtoName, fields: walkJson(first as Record<string, unknown>, dtos, used) })
        return { ...base, type: 'LIST', listItemType: 'CUSTOM', customTypeName: dtoName }
      }
      return { ...base, type: 'LIST', listItemType: itemType }
    }
    return { ...base, type: t }
  })
}

function parseJsonSample(text: string): ParseResult {
  const json = JSON.parse(text)
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw new Error('최상위 레벨은 JSON 객체({...})여야 합니다.')
  const dtos: Array<{ name: string; fields: FieldDefinition[] }> = []
  const used = new Set<string>()
  return { fields: walkJson(json as Record<string, unknown>, dtos, used), customDtos: dtos }
}

// XML
function inferXmlTextType(text: string): FieldType {
  if (text === 'true' || text === 'false') return 'BOOLEAN'
  if (/^-?\d+$/.test(text)) return 'INT'
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(text)) return 'DOUBLE'
  return 'STRING'
}

function walkXmlElement(
  el: Element,
  dtos: Array<{ name: string; fields: FieldDefinition[] }>,
  used: Set<string>,
): FieldDefinition[] {
  const counts: Record<string, number> = {}
  for (const child of Array.from(el.children)) counts[child.tagName] = (counts[child.tagName] ?? 0) + 1
  const seen = new Set<string>()
  const fields: FieldDefinition[] = []
  for (const child of Array.from(el.children)) {
    const tag = child.tagName
    if (seen.has(tag)) continue
    seen.add(tag)
    const repeated = counts[tag] > 1
    const text = child.textContent?.trim() ?? ''
    if (child.children.length > 0) {
      const dtoName = uniqueDtoName(toPascalCase(tag), dtos, used)
      dtos.push({ name: dtoName, fields: walkXmlElement(child, dtos, used) })
      fields.push({ key: tag, type: repeated ? 'LIST' : 'CUSTOM', customTypeName: dtoName, listItemType: repeated ? 'CUSTOM' : undefined, nullable: false, mandatory: true, description: tag })
    } else if (repeated) {
      fields.push({ key: tag, type: 'LIST', listItemType: inferXmlTextType(text), nullable: false, mandatory: true, description: tag })
    } else {
      fields.push({ key: tag, type: inferXmlTextType(text), nullable: false, mandatory: true, description: tag })
    }
  }
  return fields
}

function parseXmlSample(text: string): ParseResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  if (doc.querySelector('parseerror')) throw new Error('XML 파싱 오류: 형식을 확인해주세요.')
  const dtos: Array<{ name: string; fields: FieldDefinition[] }> = []
  const used = new Set<string>()
  return { fields: walkXmlElement(doc.documentElement, dtos, used), customDtos: dtos }
}

function parseSample(text: string, format: MessageFormat): ParseResult {
  if (format === 'JSON') return parseJsonSample(text)
  return parseXmlSample(text)
}

// ── SampleParserSection ────────────────────────────────────────────────────────

const SAMPLE_PLACEHOLDERS: Record<'JSON' | 'XML', string> = {
  JSON: `{\n  "field1": "value",\n  "count": 1,\n  "active": true,\n  "nested": { "a": "b" }\n}`,
  XML: `<root>\n  <field1>value</field1>\n  <count>1</count>\n  <active>true</active>\n</root>`,
}

interface SampleParserProps {
  messageFormat: MessageFormat
  hasExistingFields: boolean
  onApply: (result: ParseResult, mode: 'replace' | 'append') => void
}

function SampleParserSection({ messageFormat, hasExistingFields, onApply }: SampleParserProps) {
  const [open, setOpen] = useState(false)
  const [sampleText, setSampleText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  const handleParse = (mode: 'replace' | 'append') => {
    try {
      setParseError(null)
      const result = parseSample(sampleText.trim(), messageFormat)
      if (result.fields.length === 0) { setParseError('필드를 찾지 못했습니다. 샘플 형식을 확인해주세요.'); return }
      onApply(result, mode)
      setSampleText('')
      setOpen(false)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : '파싱 오류가 발생했습니다.')
    }
  }

  return (
    <div className="rounded border border-dashed border-slate-600 bg-slate-800/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 rounded"
      >
        <span className="font-medium">샘플에서 자동 생성</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-2">
          <div className="text-xs text-slate-500">
            {messageFormat} 샘플을 붙여넣으면 필드를 자동으로 추출합니다.
          </div>
          <textarea
            value={sampleText}
            onChange={(e) => { setSampleText(e.target.value); setParseError(null) }}
            placeholder={SAMPLE_PLACEHOLDERS[messageFormat as 'JSON' | 'XML'] ?? ''}
            className="w-full h-36 px-2 py-1.5 text-xs font-mono rounded bg-slate-900 border border-slate-600 text-slate-300 resize-y focus:outline-none focus:border-blue-500"
          />
          {parseError && <div className="text-xs text-red-400">{parseError}</div>}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleParse(hasExistingFields ? 'append' : 'replace')}
              disabled={!sampleText.trim()}
              className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40"
            >
              {hasExistingFields ? '+ 추가' : '자동 생성'}
            </button>
            {hasExistingFields && (
              <button
                onClick={() => handleParse('replace')}
                disabled={!sampleText.trim()}
                className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40"
              >
                교체
              </button>
            )}
          </div>
          {hasExistingFields && (
            <div className="text-xs text-slate-500">
              <span className="text-emerald-400">+ 추가</span>: 기존 필드에 병합 &nbsp;|&nbsp; <span className="text-amber-400">교체</span>: 기존 필드 전체 교체
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  definition: Node1Definition | undefined
  onChange: (def: Node1Definition) => void
  /** NODE0 프로토콜이 GRPC_SERVER / GRPC_CLIENT 이면 true → Protobuf 모드 고정 */
  isGrpc?: boolean
}

const FORMAT_OPTIONS: { value: MessageFormat; label: string }[] = [
  { value: 'JSON', label: 'JSON' },
  { value: 'XML', label: 'XML' },
]

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'STRING', label: 'String' },
  { value: 'INT', label: 'Int' },
  { value: 'DOUBLE', label: 'Double' },
  { value: 'BOOLEAN', label: 'Boolean' },
  { value: 'LIST', label: 'List' },
  { value: 'MAP', label: 'Map' },
  { value: 'CUSTOM', label: 'Custom' },
]

const LIST_ITEM_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'STRING', label: 'String' },
  { value: 'INT', label: 'Int' },
  { value: 'DOUBLE', label: 'Double' },
  { value: 'BOOLEAN', label: 'Boolean' },
  { value: 'MAP', label: 'Map' },
  { value: 'CUSTOM', label: 'Custom' },
]

const EMPTY_FIELD: FieldDefinition = {
  key: '',
  type: 'STRING',
  nullable: false,
  mandatory: true,
  description: '',
}

const DEFAULT_DEF: Node1Definition = {
  messageFormat: 'JSON',
  fields: [],
  customDtos: [],
}

// ── Shared field editor ───────────────────────────────────────────────────────

interface FieldEditorProps {
  field: FieldDefinition
  customDtoNames: string[]
  onChange: (f: FieldDefinition) => void
  onSave: () => void
  onCancel: () => void
  saveDisabled?: boolean
}

function FieldEditor({ field, customDtoNames, onChange, onSave, onCancel, saveDisabled }: FieldEditorProps) {
  return (
    <div className="mt-3 p-3 rounded bg-slate-800 border border-blue-500 space-y-3">
      <InputField
        label="키 (dot-notation)"
        value={field.key}
        onChange={(e) => onChange({ ...field, key: e.target.value })}
        placeholder="예: header.time"
      />
      <SelectField
        label="타입"
        value={field.type}
        onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })}
        options={FIELD_TYPE_OPTIONS}
      />
      {field.type === 'CUSTOM' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-300">커스텀 타입 이름</label>
          {customDtoNames.length > 0 ? (
            <select
              value={field.customTypeName ?? ''}
              onChange={(e) => onChange({ ...field, customTypeName: e.target.value })}
              className="w-full px-2 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">-- 선택 --</option>
              {customDtoNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          ) : (
            <InputField
              label=""
              value={field.customTypeName ?? ''}
              onChange={(e) => onChange({ ...field, customTypeName: e.target.value })}
              placeholder="예: Item (아래 커스텀 DTO에 정의 필요)"
            />
          )}
          {customDtoNames.length === 0 && (
            <div className="text-xs text-amber-400/80">아래 커스텀 DTO 섹션에서 먼저 타입을 정의하세요.</div>
          )}
        </div>
      )}
      {field.type === 'LIST' && (
        <div className="space-y-1">
          <SelectField
            label="리스트 원소 타입"
            value={field.listItemType ?? ''}
            onChange={(e) => onChange({ ...field, listItemType: e.target.value as FieldType || undefined })}
            options={[{ value: '' as FieldType, label: '-- 미지정 --' }, ...LIST_ITEM_TYPE_OPTIONS]}
          />
          {field.listItemType === 'CUSTOM' && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-300">커스텀 타입 이름</label>
              {customDtoNames.length > 0 ? (
                <select
                  value={field.customTypeName ?? ''}
                  onChange={(e) => onChange({ ...field, customTypeName: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- 선택 --</option>
                  {customDtoNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <InputField
                  label=""
                  value={field.customTypeName ?? ''}
                  onChange={(e) => onChange({ ...field, customTypeName: e.target.value })}
                  placeholder="예: Item (아래 커스텀 DTO에 정의 필요)"
                />
              )}
              {customDtoNames.length === 0 && (
                <div className="text-xs text-amber-400/80">아래 커스텀 DTO 섹션에서 먼저 타입을 정의하세요.</div>
              )}
            </div>
          )}
        </div>
      )}
      <InputField
        label="기본값"
        value={field.defaultValue ?? ''}
        onChange={(e) => onChange({ ...field, defaultValue: e.target.value || undefined })}
        placeholder="비어있으면 타입 기본값 사용"
      />
      <InputField
        label="설명 (필수)"
        value={field.description}
        onChange={(e) => onChange({ ...field, description: e.target.value })}
        placeholder="이 필드에 대한 설명"
      />
      <div className="flex gap-4">
        <CheckboxField
          label="Nullable"
          checked={field.nullable}
          onChange={(v) => onChange({ ...field, nullable: v })}
        />
        <CheckboxField
          label="필수 (Mandatory)"
          checked={field.mandatory}
          onChange={(v) => onChange({ ...field, mandatory: v })}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saveDisabled}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
        >
          저장
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white"
        >
          취소
        </button>
      </div>
    </div>
  )
}

// ── Field list row ─────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDefinition
  onEdit: () => void
  onRemove: () => void
}

function FieldRow({ field, onEdit, onRemove }: FieldRowProps) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-700 border border-slate-600 text-xs">
      <div className="flex-1 min-w-0">
        <span className="text-blue-300 font-mono">{field.key}</span>
        <span className="text-slate-400 ml-2">
          {field.type === 'LIST'
            ? `List<${field.listItemType === 'CUSTOM' && field.customTypeName ? field.customTypeName : (field.listItemType ?? '?')}>`
            : field.type === 'CUSTOM' && field.customTypeName ? field.customTypeName : field.type}
        </span>
        {field.nullable && <span className="text-yellow-500 ml-1">nullable</span>}
        {field.mandatory ? (
          <span className="text-emerald-400 ml-1">mandatory</span>
        ) : (
          <span className="text-slate-500 ml-1">optional</span>
        )}
      </div>
      <div className="flex gap-1 shrink-0 ml-2">
        <button onClick={onEdit} className="text-slate-400 hover:text-white px-1">&#9999;&#65039;</button>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-400 px-1">&#10005;</button>
      </div>
    </div>
  )
}

// ── Custom DTO section ─────────────────────────────────────────────────────────

interface CustomDtoSectionProps {
  customDtos: Node1Definition['customDtos']
  onChange: (dtos: Node1Definition['customDtos']) => void
}

function CustomDtoSection({ customDtos, onChange }: CustomDtoSectionProps) {
  const [editingDtoIndex, setEditingDtoIndex] = useState<number | null>(null)
  const [newDtoName, setNewDtoName] = useState('')
  const [addingDto, setAddingDto] = useState(false)

  // Per-DTO field editing state
  const [editingFieldIndex, setEditingFieldIndex] = useState<Record<number, number | null>>({})
  const [editingFields, setEditingFields] = useState<Record<number, FieldDefinition>>({})

  const allCustomDtoNames = customDtos.map((d) => d.name)

  const addDto = () => {
    const trimmed = newDtoName.trim()
    if (!trimmed) return
    const updated = [...customDtos, { name: trimmed, fields: [] }]
    onChange(updated)
    setNewDtoName('')
    setAddingDto(false)
    setEditingDtoIndex(updated.length - 1)
  }

  const removeDto = (i: number) => {
    onChange(customDtos.filter((_, idx) => idx !== i))
  }

  const renameDtoField = (dtoIdx: number, name: string) => {
    const updated = customDtos.map((dto, i) => i === dtoIdx ? { ...dto, name } : dto)
    onChange(updated)
  }

  const updateDtoFields = (dtoIdx: number, fields: FieldDefinition[]) => {
    const updated = customDtos.map((dto, i) => i === dtoIdx ? { ...dto, fields } : dto)
    onChange(updated)
  }

  const startEditField = (dtoIdx: number, fieldIdx: number) => {
    setEditingFieldIndex({ ...editingFieldIndex, [dtoIdx]: fieldIdx })
    setEditingFields({ ...editingFields, [dtoIdx]: customDtos[dtoIdx].fields[fieldIdx] })
  }

  const startAddField = (dtoIdx: number) => {
    const nextIdx = customDtos[dtoIdx].fields.length
    setEditingFieldIndex({ ...editingFieldIndex, [dtoIdx]: nextIdx })
    setEditingFields({ ...editingFields, [dtoIdx]: { ...EMPTY_FIELD } })
  }

  const saveField = (dtoIdx: number) => {
    const fi = editingFieldIndex[dtoIdx]
    const ef = editingFields[dtoIdx]
    if (fi == null || !ef.key || !ef.description) return
    const fields = [...customDtos[dtoIdx].fields]
    fields[fi] = ef
    updateDtoFields(dtoIdx, fields)
    setEditingFieldIndex({ ...editingFieldIndex, [dtoIdx]: null })
  }

  const cancelField = (dtoIdx: number) => {
    setEditingFieldIndex({ ...editingFieldIndex, [dtoIdx]: null })
  }

  const removeField = (dtoIdx: number, fieldIdx: number) => {
    const fields = customDtos[dtoIdx].fields.filter((_, i) => i !== fieldIdx)
    updateDtoFields(dtoIdx, fields)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">커스텀 DTO 정의</span>
        <button
          onClick={() => setAddingDto(true)}
          className="text-xs px-2 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white"
        >
          + DTO 추가
        </button>
      </div>

      {/* Hint */}
      <div className="text-xs text-slate-500 leading-relaxed">
        위 필드에서 <span className="text-violet-300 font-mono">CUSTOM</span> 타입을 사용할 경우, 여기에 해당 타입의 구조를 정의하세요.
      </div>

      {/* Add new DTO form */}
      {addingDto && (
        <div className="p-3 rounded bg-slate-800 border border-violet-500 space-y-2">
          <InputField
            label="DTO 이름"
            value={newDtoName}
            onChange={(e) => setNewDtoName(e.target.value)}
            placeholder="예: Item"
          />
          <div className="flex gap-2">
            <button
              onClick={addDto}
              disabled={!newDtoName.trim()}
              className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40"
            >
              추가
            </button>
            <button
              onClick={() => { setAddingDto(false); setNewDtoName('') }}
              className="px-3 py-1.5 text-xs rounded bg-slate-600 hover:bg-slate-500 text-white"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* DTO cards */}
      {customDtos.map((dto, dtoIdx) => {
        const isExpanded = editingDtoIndex === dtoIdx
        const fi = editingFieldIndex[dtoIdx] ?? null
        const ef = editingFields[dtoIdx]

        return (
          <div key={dtoIdx} className="rounded border border-slate-600 bg-slate-800/50">
            {/* DTO header */}
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-700/50 rounded-t"
              onClick={() => setEditingDtoIndex(isExpanded ? null : dtoIdx)}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 select-none">{isExpanded ? '▼' : '▶'}</span>
                <span className="text-sm font-semibold text-violet-300 font-mono">{dto.name}</span>
                <span className="text-xs text-slate-500">({dto.fields.length}개 필드)</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeDto(dtoIdx) }}
                className="text-slate-500 hover:text-red-400 text-xs px-1"
              >
                삭제
              </button>
            </div>

            {/* DTO body */}
            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-2">
                {/* DTO rename */}
                <InputField
                  label="DTO 이름"
                  value={dto.name}
                  onChange={(e) => renameDtoField(dtoIdx, e.target.value)}
                  placeholder="예: Item"
                />

                {/* Field list header */}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs font-medium text-slate-400">필드 목록</span>
                  <button
                    onClick={() => startAddField(dtoIdx)}
                    className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    + 필드 추가
                  </button>
                </div>

                {/* Field rows */}
                <div className="space-y-1">
                  {dto.fields.map((field, fieldIdx) => (
                    <FieldRow
                      key={fieldIdx}
                      field={field}
                      onEdit={() => startEditField(dtoIdx, fieldIdx)}
                      onRemove={() => removeField(dtoIdx, fieldIdx)}
                    />
                  ))}
                  {dto.fields.length === 0 && (
                    <div className="text-xs text-slate-600 italic px-2 py-1">아직 필드가 없습니다.</div>
                  )}
                </div>

                {/* Field editor */}
                {fi !== null && ef && (
                  <FieldEditor
                    field={ef}
                    customDtoNames={allCustomDtoNames.filter((n) => n !== dto.name)}
                    onChange={(f) => setEditingFields({ ...editingFields, [dtoIdx]: f })}
                    onSave={() => saveField(dtoIdx)}
                    onCancel={() => cancelField(dtoIdx)}
                    saveDisabled={!ef.key || !ef.description}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      {customDtos.length === 0 && !addingDto && (
        <div className="text-xs text-slate-600 italic px-1">정의된 커스텀 DTO가 없습니다.</div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function Node1Panel({ definition, onChange, isGrpc = false }: Props) {
  const rawDef = definition ?? DEFAULT_DEF
  // gRPC 모드: messageFormat 을 PROTOBUF 로 자동 설정
  const def: Node1Definition = isGrpc
    ? { ...rawDef, messageFormat: 'PROTOBUF' }
    : rawDef

  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingField, setEditingField] = useState<FieldDefinition>(EMPTY_FIELD)

  const customDtoNames = def.customDtos.map((d) => d.name)

  // gRPC 모드: proto 스키마 변경 → fields + customDtos 자동 파생 후 저장
  const handleProtoSchemaChange = (protoSchema: ProtoFieldDef[], protoMessages: ProtoMessageDef[]) => {
    // 중첩 MESSAGE 타입 → customDtos 파생
    const derivedDtos = protoMessages.map(pm => ({
      name: pm.name,
      fields: pm.fields.map(pf => ({
        key:          pf.name,
        type:         protoTypeToFieldType(pf),
        listItemType: pf.label === 'REPEATED' ? protoTypeToScalarFieldType(pf.type) : undefined,
        customTypeName: pf.messageTypeName,
        nullable:     false,
        mandatory:    false,
        description:  pf.name,
      } as FieldDefinition)),
    }))

    // 루트 필드 파생 (MESSAGE 타입 필드 → CUSTOM 타입)
    const derivedFields: FieldDefinition[] = protoSchema.map(pf => ({
      key:          pf.name,
      type:         pf.messageTypeName ? 'CUSTOM' : protoTypeToFieldType(pf),
      listItemType: pf.label === 'REPEATED' && !pf.messageTypeName
        ? protoTypeToScalarFieldType(pf.type)
        : pf.label === 'REPEATED' && pf.messageTypeName ? 'CUSTOM' : undefined,
      customTypeName: pf.messageTypeName,
      nullable:     false,
      mandatory:    false,
      description:  pf.name,
    }))

    onChange({ ...def, messageFormat: 'PROTOBUF', protoSchema, protoMessages, fields: derivedFields, customDtos: derivedDtos })
  }

  const handleSampleApply = (result: ParseResult, mode: 'replace' | 'append') => {
    if (mode === 'replace') {
      onChange({ ...def, fields: result.fields, customDtos: result.customDtos })
    } else {
      const existingKeys = new Set(def.fields.map((f) => f.key))
      const existingDtoNames = new Set(def.customDtos.map((d) => d.name))
      onChange({
        ...def,
        fields: [...def.fields, ...result.fields.filter((f) => !existingKeys.has(f.key))],
        customDtos: [...def.customDtos, ...result.customDtos.filter((d) => !existingDtoNames.has(d.name))],
      })
    }
  }

  const addField = () => {
    setEditingField({ ...EMPTY_FIELD })
    setEditingIndex(def.fields.length)
  }

  const saveField = () => {
    if (!editingField.key || !editingField.description) return
    const newFields = [...def.fields]
    if (editingIndex !== null) {
      newFields[editingIndex] = editingField
    }
    onChange({ ...def, fields: newFields })
    setEditingIndex(null)
  }

  const removeField = (i: number) => {
    onChange({ ...def, fields: def.fields.filter((_, idx) => idx !== i) })
  }

  // ── gRPC (Protobuf) 모드 ──────────────────────────────────────────────────
  if (isGrpc) {
    return (
      <div className="space-y-5">
        <div className="p-2.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-300 space-y-0.5">
          <div className="font-semibold">Protobuf 모드</div>
          <div className="text-cyan-400/80">gRPC 프로토콜이 선택되어 메시지 형식이 Protobuf로 고정됩니다.</div>
        </div>
        <ProtoSchemaEditor
          fields={def.protoSchema ?? []}
          messages={def.protoMessages ?? []}
          onChange={handleProtoSchemaChange}
        />
      </div>
    )
  }

  // ── JSON / XML 모드 (기존) ────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Message format */}
      <SelectField
        label="메세지 형식"
        value={def.messageFormat}
        onChange={(e) => onChange({ ...def, messageFormat: e.target.value as MessageFormat })}
        options={FORMAT_OPTIONS}
      />

      <SampleParserSection
        messageFormat={def.messageFormat}
        hasExistingFields={def.fields.length > 0}
        onApply={handleSampleApply}
      />

      {/* ── Main fields ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-300">필드 정의</span>
          <button
            onClick={addField}
            className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
          >
            + 추가
          </button>
        </div>

        <div className="space-y-1">
          {def.fields.map((field, i) => (
            <FieldRow
              key={i}
              field={field}
              onEdit={() => { setEditingField(field); setEditingIndex(i) }}
              onRemove={() => removeField(i)}
            />
          ))}
        </div>

        {editingIndex !== null && (
          <FieldEditor
            field={editingField}
            customDtoNames={customDtoNames}
            onChange={setEditingField}
            onSave={saveField}
            onCancel={() => setEditingIndex(null)}
            saveDisabled={!editingField.key || !editingField.description}
          />
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-slate-700" />

      {/* ── Custom DTOs ── */}
      <CustomDtoSection
        customDtos={def.customDtos}
        onChange={(dtos) => onChange({ ...def, customDtos: dtos })}
      />

      {/* ── Field structure preview ── */}
      <FieldStructurePreview
        fields={def.fields}
        customDtos={def.customDtos}
        rootName="Message"
      />
    </div>
  )
}

// ── proto 타입 → FieldType 변환 헬퍼 (Node1 fields 자동 파생용) ───────────────

import { ProtoFieldType as PFT } from '../../types/workflow'

function protoTypeToFieldType(pf: ProtoFieldDef): FieldType {
  if (pf.label === 'REPEATED') return 'LIST'
  return protoTypeToScalarFieldType(pf.type)
}

function protoTypeToScalarFieldType(t: PFT): FieldType {
  switch (t) {
    case 'BOOL':                          return 'BOOLEAN'
    case 'INT32': case 'INT64':
    case 'UINT32': case 'UINT64':
    case 'SINT32': case 'SINT64':         return 'INT'
    case 'FLOAT': case 'DOUBLE':          return 'DOUBLE'
    case 'BYTES':                         return 'STRING'   // bytes → STRING 폴백
    default:                              return 'STRING'
  }
}
