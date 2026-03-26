import { create } from 'zustand'
import axios from 'axios'

export interface HistoryEntry {
  version: number
  modifiedBy: string
  modifiedAt: string
  tree: {
    units: Array<{ id: string; name: string; condition: { rawExpression?: string; type: string } }>
  }
}

interface HistoryStore {
  entries: HistoryEntry[]
  isOpen: boolean
  loading: boolean
  error: string | null
  openDrawer: () => void
  closeDrawer: () => void
  fetchHistory: () => Promise<void>
  rollback: (version: number, modifiedBy: string, password: string) => Promise<void>
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  isOpen: false,
  loading: false,
  error: null,

  openDrawer: () => set({ isOpen: true }),
  closeDrawer: () => set({ isOpen: false }),

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
      set({ loading: false, isOpen: false })
    } catch (e: any) {
      set({ error: e.response?.data?.error ?? e.message, loading: false })
      throw e
    }
  },
}))
