import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import axios from 'axios'
import WorkflowPage from './pages/WorkflowPage'
import LogPage from './pages/LogPage'
import ReferencePage from './pages/ReferencePage'
import MonitoringPage from './pages/MonitoringPage'
import DeadLetterPage from './pages/DeadLetterPage'
import SimulatorPage from './pages/SimulatorPage'
import LoginPage from './pages/LoginPage'
import AccountManagementPage from './pages/AccountManagementPage'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuthStore } from './store/authStore'

function AppShell() {
  const { token, username, role, logout, init, initialized, isSuperAdmin } = useAuthStore()
  const navigate = useNavigate()

  const [showChangePw, setShowChangePw] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changePwError, setChangePwError] = useState<string | null>(null)
  const [changePwLoading, setChangePwLoading] = useState(false)
  const [changePwSuccess, setChangePwSuccess] = useState(false)

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) { setChangePwError('새 비밀번호가 일치하지 않습니다.'); return }
    setChangePwError(null)
    setChangePwLoading(true)
    try {
      await axios.post('/synapse/auth/change-password', { currentPassword: currentPw, newPassword: newPw })
      setChangePwSuccess(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e: any) {
      setChangePwError(e.response?.data?.error ?? e.message)
    } finally {
      setChangePwLoading(false)
    }
  }

  const closeChangePw = () => {
    setShowChangePw(false)
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setChangePwError(null); setChangePwSuccess(false)
  }

  useEffect(() => { init() }, [])

  if (!initialized) {
    return <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400 text-sm">로딩 중...</div>
  }

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex flex-col h-screen">
      <nav className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-700">
        <NavLink to="/" end
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >워크플로우</NavLink>
        <NavLink to="/logs"
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >로그</NavLink>
        <NavLink to="/reference"
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >기준정보</NavLink>
        <NavLink to="/monitor"
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >모니터링</NavLink>
        <NavLink to="/dead-letters"
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-red-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >데드레터</NavLink>
        <NavLink to="/simulator"
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-green-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
        >시뮬레이터</NavLink>
        {isSuperAdmin() && (
          <NavLink to="/accounts"
            className={({ isActive }) =>
              `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          >계정관리</NavLink>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {username}
            {role === 'SUPER_ADMIN' && <span className="ml-1 text-yellow-400">[슈퍼어드민]</span>}
            {role === 'ADMIN' && <span className="ml-1 text-blue-400">[어드민]</span>}
            {role === 'GENERAL' && <span className="ml-1 text-slate-500">[일반]</span>}
          </span>
          <button onClick={() => setShowChangePw(true)}
            className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded">
            비밀번호 변경
          </button>
          <button onClick={handleLogout}
            className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded">
            로그아웃
          </button>
        </div>
      </nav>

      {showChangePw && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-lg mb-4">비밀번호 변경</h2>
            {changePwSuccess ? (
              <div className="space-y-4">
                <p className="text-green-400 text-sm">비밀번호가 성공적으로 변경되었습니다.</p>
                <button onClick={closeChangePw}
                  className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm">
                  닫기
                </button>
              </div>
            ) : (
              <form onSubmit={handleChangePw} className="space-y-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">현재 비밀번호</label>
                  <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">새 비밀번호</label>
                  <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">새 비밀번호 확인</label>
                  <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    required />
                </div>
                {changePwError && <p className="text-red-400 text-sm">{changePwError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closeChangePw}
                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm">
                    취소
                  </button>
                  <button type="submit" disabled={changePwLoading}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm">
                    {changePwLoading ? '변경 중...' : '변경'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<WorkflowPage />} />
          <Route path="/logs" element={<LogPage />} />
          <Route path="/reference" element={<ReferencePage />} />
          <Route path="/monitor" element={<MonitoringPage />} />
          <Route path="/dead-letters" element={<DeadLetterPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/accounts" element={
            <ProtectedRoute requireSuperAdmin><AccountManagementPage /></ProtectedRoute>
          } />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
