import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import WorkflowPage from './pages/WorkflowPage'
import LogPage from './pages/LogPage'
import ReferencePage from './pages/ReferencePage'
import MonitoringPage from './pages/MonitoringPage'
import DeadLetterPage from './pages/DeadLetterPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen">
        <nav className="flex gap-1 px-4 py-2 bg-slate-900 border-b border-slate-700">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`
            }
          >
            워크플로우
          </NavLink>
          <NavLink
            to="/logs"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`
            }
          >
            로그
          </NavLink>
          <NavLink
            to="/reference"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`
            }
          >
            기준정보
          </NavLink>
          <NavLink
            to="/monitor"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`
            }
          >
            모니터링
          </NavLink>
          <NavLink
            to="/dead-letters"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${
                isActive ? 'bg-red-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`
            }
          >
            데드레터
          </NavLink>
        </nav>
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<WorkflowPage />} />
            <Route path="/logs" element={<LogPage />} />
            <Route path="/reference" element={<ReferencePage />} />
            <Route path="/monitor" element={<MonitoringPage />} />
            <Route path="/dead-letters" element={<DeadLetterPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
