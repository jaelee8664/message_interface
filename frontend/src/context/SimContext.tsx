import { createContext, useContext } from 'react'
import type { SimulationNodeTrace } from '../components/simulator/PipelineTraceView'

interface SimContextValue {
  traceMap: Record<string, SimulationNodeTrace>
  edgeSnapshotMap: Record<string, Record<string, unknown> | null>
  activeNodeId: string | null
}

const SimContext = createContext<SimContextValue>({
  traceMap: {},
  edgeSnapshotMap: {},
  activeNodeId: null,
})

export const useSimContext = () => useContext(SimContext)
export default SimContext
