import { useState } from 'react'
import { FieldDefinition, MessageFormat } from '../../types/workflow'

interface CustomDto { name: string; fields: FieldDefinition[] }

interface Props {
  fields: FieldDefinition[]
  customDtos?: CustomDto[]
  rootName?: string
}

// ── JSON Generator ─────────────────────────────────────────────────────────────

function buildJsonValue(f: FieldDefinition, dtos: CustomDto[]): unknown {
  if (f.nullable) return null
  const d = f.defaultValue
  switch (f.type) {
    case 'STRING':  return d ?? 'string'
    case 'INT':     return d != null ? parseInt(d) : 0
    case 'DOUBLE':  return d != null ? parseFloat(d) : 0.0
    case 'BOOLEAN': return d === 'true'
    case 'MAP':     return {}
    case 'LIST': {
      if (f.listItemType === 'CUSTOM' && f.customTypeName) {
        const dto = dtos.find(x => x.name === f.customTypeName)
        if (dto) return [buildJsonObj(dto.fields, dtos)]
      }
      const scalar: Record<string, unknown> = { STRING: 'string', INT: 0, DOUBLE: 0.0, BOOLEAN: false, MAP: {} }
      return [scalar[f.listItemType ?? 'STRING'] ?? 'string']
    }
    case 'CUSTOM': {
      if (f.customTypeName) {
        const dto = dtos.find(x => x.name === f.customTypeName)
        if (dto) return buildJsonObj(dto.fields, dtos)
      }
      return {}
    }
    default: return d ?? 'string'
  }
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null || Array.isArray(cur[parts[i]])) {
      cur[parts[i]] = {}
    }
    cur = cur[parts[i]] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

function buildJsonObj(fields: FieldDefinition[], dtos: CustomDto[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const f of fields) setPath(obj, f.key, buildJsonValue(f, dtos))
  return obj
}

function generateJson(fields: FieldDefinition[], dtos: CustomDto[]): string {
  if (!fields.length) return '{}'
  return JSON.stringify(buildJsonObj(fields, dtos), null, 2)
}

// ── XML Generator ──────────────────────────────────────────────────────────────

function valToXml(val: unknown, tag: string, indent: string): string {
  if (val === null || val === undefined) return `${indent}<${tag}/>`
  if (Array.isArray(val)) {
    const items = val as unknown[]
    if (!items.length) return `${indent}<${tag}/>`
    return items.map(item => valToXml(item, tag, indent)).join('\n')
  }
  if (typeof val === 'object') {
    const children = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => valToXml(v, k, indent + '  '))
      .join('\n')
    return `${indent}<${tag}>\n${children}\n${indent}</${tag}>`
  }
  return `${indent}<${tag}>${val}</${tag}>`
}

function generateXml(fields: FieldDefinition[], dtos: CustomDto[], root: string): string {
  if (!fields.length) return `<${root}/>`
  const obj = buildJsonObj(fields, dtos)
  const body = Object.entries(obj).map(([k, v]) => valToXml(v, k, '  ')).join('\n')
  return `<${root}>\n${body}\n</${root}>`
}

// ── Protobuf Generator ─────────────────────────────────────────────────────────

const PROTO_SCALAR: Record<string, string> = {
  STRING: 'string', INT: 'int32', DOUBLE: 'double', BOOLEAN: 'bool',
}

function fieldToProto(f: FieldDefinition, num: number): string {
  const key = f.key.replace(/\./g, '_')
  const opt = f.nullable ? 'optional ' : ''
  if (f.type === 'LIST') {
    const itemType = f.listItemType === 'CUSTOM' && f.customTypeName
      ? f.customTypeName
      : PROTO_SCALAR[f.listItemType ?? 'STRING'] ?? 'string'
    return `  repeated ${itemType} ${key} = ${num};`
  }
  if (f.type === 'CUSTOM' && f.customTypeName) return `  ${opt}${f.customTypeName} ${key} = ${num};`
  if (f.type === 'MAP') return `  ${opt}map<string, string> ${key} = ${num};`
  return `  ${opt}${PROTO_SCALAR[f.type] ?? 'string'} ${key} = ${num};`
}

function generateProto(fields: FieldDefinition[], dtos: CustomDto[], root: string): string {
  if (!fields.length) return `message ${root} {}`
  const lines = [`message ${root} {`]
  fields.forEach((f, i) => lines.push(fieldToProto(f, i + 1)))
  lines.push('}')
  for (const dto of dtos) {
    lines.push('')
    lines.push(`message ${dto.name} {`)
    dto.fields.forEach((f, i) => lines.push(fieldToProto(f, i + 1)))
    lines.push('}')
  }
  return lines.join('\n')
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FieldStructurePreview({ fields, customDtos = [], rootName = 'Message' }: Props) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<MessageFormat>('JSON')
  const [copied, setCopied] = useState(false)

  if (!fields.length) return null

  const preview =
    format === 'JSON' ? generateJson(fields, customDtos) :
    format === 'XML'  ? generateXml(fields, customDtos, rootName) :
    generateProto(fields, customDtos, rootName)

  const copy = () => {
    navigator.clipboard.writeText(preview).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded border border-dashed border-slate-600 bg-slate-800/30">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/30 rounded"
      >
        <span className="font-medium">필드 구조 미리보기</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700 pt-2">
          <div className="flex items-center gap-1">
            {(['JSON', 'XML', 'PROTOBUF'] as MessageFormat[]).map(f => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  format === f ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {f === 'PROTOBUF' ? 'Protobuf' : f}
              </button>
            ))}
            <button
              onClick={copy}
              className="ml-auto px-2.5 py-1 text-xs rounded bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              {copied ? '복사됨 ✓' : '복사'}
            </button>
          </div>
          <pre className="w-full rounded bg-slate-900 border border-slate-700 p-3 text-xs font-mono text-slate-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
            {preview}
          </pre>
        </div>
      )}
    </div>
  )
}
