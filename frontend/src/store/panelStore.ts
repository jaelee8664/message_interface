import { create } from 'zustand'
import { WorkflowCondition, WorkflowNode, WorkflowUnit } from '../types/workflow'

interface PanelStore {
  activeNode: WorkflowNode | null
  activeUnit: WorkflowUnit | null
  isOpen: boolean
  /** Set by WorkflowPage; called when user clicks "Delete Node" in the panel. */
  onDeleteNode: ((nodeId: string) => void) | null
  /** Set by WorkflowPage; called when user clicks "확인" in the panel to apply edits. */
  onUpdateNode: ((node: WorkflowNode) => void) | null
  /** Set by WorkflowPage; called when NODE0 condition is edited and confirmed. */
  onUpdateCondition: ((condition: WorkflowCondition) => void) | null
  openPanel: (node: WorkflowNode, unit: WorkflowUnit) => void
  closePanel: () => void
  registerDeleteHandler: (handler: (nodeId: string) => void) => void
  registerUpdateHandler: (handler: (node: WorkflowNode) => void) => void
  registerUpdateConditionHandler: (handler: (condition: WorkflowCondition) => void) => void
}

export const usePanelStore = create<PanelStore>((set) => ({
  activeNode: null,
  activeUnit: null,
  isOpen: false,
  onDeleteNode: null,
  onUpdateNode: null,
  onUpdateCondition: null,
  openPanel: (node, unit) => set({ activeNode: node, activeUnit: unit, isOpen: true }),
  closePanel: () => set({ isOpen: false, activeNode: null, activeUnit: null }),
  registerDeleteHandler: (handler) => set({ onDeleteNode: handler }),
  registerUpdateHandler: (handler) => set({ onUpdateNode: handler }),
  registerUpdateConditionHandler: (handler) => set({ onUpdateCondition: handler }),
}))
