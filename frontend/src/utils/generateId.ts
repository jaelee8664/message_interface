export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
