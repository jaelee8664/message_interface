import { NodeErrorField } from '../types/workflow'

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
      f.source === 'LITERAL'            ? (f.value || '""')
      : f.source === 'FROM_SESSION_VAR' ? `{sessionVars["${f.value}"]}`
      : f.source === 'EXCEPTION_MESSAGE' ? '{exception.message}'
      : `{currentMap["${f.value}"]}`
    setNestedPath(obj, f.key, display)
  }
  return hasKeys ? JSON.stringify(obj, null, 2) : emptyMsg
}
