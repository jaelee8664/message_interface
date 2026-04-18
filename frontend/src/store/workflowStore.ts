import { create } from 'zustand'
import { WorkflowUnit } from '../types/workflow'
import axios from 'axios'

interface WorkflowStore {
  units: WorkflowUnit[]
  selectedUnitId: string | null
  loading: boolean
  error: string | null

  fetchUnits: () => Promise<void>
  selectUnit: (id: string | null) => void
  saveUnit: (unit: WorkflowUnit) => Promise<void>
  deleteUnit: (unitId: string) => Promise<void>
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  units: [],
  selectedUnitId: null,
  loading: false,
  error: null,

  fetchUnits: async () => {
    set({ loading: true, error: null })
    try {
      const res = await axios.get('/synapse/workflow/units')
      set({ units: res.data.data ?? [], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  selectUnit: (id) => set({ selectedUnitId: id }),

  saveUnit: async (unit) => {
    set({ loading: true, error: null })
    try {
      await axios.post('/synapse/workflow/units', { unit })
      await get().fetchUnits()
    } catch (e: any) {
      set({ error: e.response?.data?.error ?? e.message, loading: false })
      throw e
    }
  },

  deleteUnit: async (unitId) => {
    set({ loading: true, error: null })
    try {
      await axios.delete('/synapse/workflow/units', { data: { unitId } })
      await get().fetchUnits()
    } catch (e: any) {
      set({ error: e.response?.data?.error ?? e.message, loading: false })
      throw e
    }
  },
}))
