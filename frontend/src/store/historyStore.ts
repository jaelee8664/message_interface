import { create } from 'zustand'
import axios from 'axios'

export interface HistoryEntry {
  id: string
  version: number
  modifiedBy: string
  modifiedAt: string
  units: Array<{ id: string; name: string; condition: { rawExpression?: string; type: string } }>
}

export interface FieldDiff {
  field: string
  before: string | null
  after: string | null
}

export interface NodeDiff {
  nodeType: string
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED'
  fieldDiffs: FieldDiff[]
}

export interface UnitDiff {
  id: string
  beforeName: string | null
  afterName: string | null
  status: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED'
  nodeDiffs: NodeDiff[]
}

export interface DiffResult {
  version: number
  modifiedBy: string
  modifiedAt: string
  unitDiffs: UnitDiff[]
}

interface HistoryStore {
  entries: HistoryEntry[]
  isOpen: boolean
  loading: boolean
  error: string | null

  diffResult: DiffResult | null
  diffLoading: boolean
  diffError: string | null

  openDrawer: () => void
  closeDrawer: () => void
  fetchHistory: () => Promise<void>
  rollback: (version: number, modifiedBy: string, password: string) => Promise<void>
  openDiff: (version: number) => Promise<void>
  closeDiff: () => void
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  isOpen: false,
  loading: false,
  error: null,

  diffResult: null,
  diffLoading: false,
  diffError: null,

  openDrawer: () => set({ isOpen: true }),
  closeDrawer: () => set({ isOpen: false, diffResult: null, diffError: null }),

  fetchHistory: async () => {
    set({ loading: true, error: null })
    try {
      const res = await axios.get('/synapse/workflow/history')
      set({ entries: res.data.data ?? [], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  rollback: async (version, modifiedBy, password) => {
    set({ loading: true, error: null })
    try {
      await axios.post('/synapse/workflow/rollback', { version, modifiedBy, password })
      set({ loading: false, isOpen: false, diffResult: null })
    } catch (e: any) {
      set({ error: e.response?.data?.error ?? e.message, loading: false })
      throw e
    }
  },

  openDiff: async (version) => {
    set({ diffLoading: true, diffError: null, diffResult: null })
    try {
      const res = await axios.get('/synapse/workflow/diff', { params: { version } })
      set({ diffResult: res.data.data, diffLoading: false })
    } catch (e: any) {
      set({ diffError: e.response?.data?.error ?? e.message, diffLoading: false })
    }
  },

  closeDiff: () => set({ diffResult: null, diffError: null }),
}))
