import { MessageFormat, NodeErrorField, NodeErrorFieldSource } from '../types/workflow'

// ── Nested preview ────────────────────────────────────────────────────────────

function setNestedPath(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (typeof current[part] !== 'object' || current[part] === null || Array.isArray(current[part])) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

export function buildNestedPreview(
  fields: NodeErrorField[],
  emptyMsg = '(빈 body — 필드를 추가하면 body가 생성됩니다)'
): string {
  const obj: Record<string, unknown> = {}
  let hasKeys = false
  for (const f of fields) {
    if (!f.key) continue
    hasKeys = true
    const display =
      f.source === 'LITERAL'             ? (f.value || '(빈값)')
      : f.source === 'FROM_SESSION_VAR'  ? `<sessionVars.${f.value}>`
      : f.source === 'EXCEPTION_MESSAGE' ? '<exception.message>'
      : `<currentMap.${f.value}>`
    setNestedPath(obj, f.key, display)
  }
  return hasKeys ? JSON.stringify(obj, null, 2) : emptyMsg
}

// ── Sample import parsing ─────────────────────────────────────────────────────

function flattenJsonLeaves(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [prefix] : []
  }
  const result: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result.push(...flattenJsonLeaves(v, path))
    } else {
      result.push(path)
    }
  }
  return result
}

function flattenXmlLeaves(el: Element, prefix = ''): string[] {
  const result: string[] = []
  for (const child of Array.from(el.children)) {
    const path = prefix ? `${prefix}.${child.tagName}` : child.tagName
    if (child.children.length > 0) {
      result.push(...flattenXmlLeaves(child, path))
    } else {
      result.push(path)
    }
  }
  return result
}

export function parseSampleToFields(text: string, format: MessageFormat): NodeErrorField[] {
  let paths: string[]
  if (format === 'JSON') {
    const json = JSON.parse(text)
    if (typeof json !== 'object' || json === null || Array.isArray(json))
      throw new Error('최상위 레벨은 JSON 객체({...})여야 합니다.')
    paths = flattenJsonLeaves(json)
  } else {
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'application/xml')
    if (doc.querySelector('parseerror')) throw new Error('XML 파싱 오류: 형식을 확인해주세요.')
    paths = flattenXmlLeaves(doc.documentElement)
  }
  if (paths.length === 0) throw new Error('필드를 찾지 못했습니다. 샘플 형식을 확인해주세요.')
  return paths.map(p => ({ key: p, source: 'FROM_MAP' as NodeErrorFieldSource, value: p }))
}

export const SAMPLE_PLACEHOLDERS: Record<'JSON' | 'XML', string> = {
  JSON: `{\n  "header": { "msgName": "RESPONSE" },\n  "data": { "result": "OK", "code": 0 }\n}`,
  XML: `<MESSAGE>\n  <HEADER>\n    <MESSAGENAME>RESPONSE</MESSAGENAME>\n  </HEADER>\n  <DATA>\n    <RESULT>OK</RESULT>\n  </DATA>\n</MESSAGE>`,
}
