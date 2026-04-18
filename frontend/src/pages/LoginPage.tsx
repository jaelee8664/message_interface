import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuthStore } from '../store/authStore'

type Tab = 'login' | 'register'

export default function LoginPage() {
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [regUsername, setRegUsername] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regError, setRegError] = useState<string | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [regSuccess, setRegSuccess] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (e: any) {
      setError(e.response?.data?.error ?? '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegError(null)
    if (regPassword !== regConfirm) {
      setRegError('비밀번호가 일치하지 않습니다.')
      return
    }
    setRegLoading(true)
    try {
      await axios.post('/synapse/auth/register', { username: regUsername, password: regPassword })
      setRegSuccess(true)
      setRegUsername('')
      setRegPassword('')
      setRegConfirm('')
    } catch (e: any) {
      setRegError(e.response?.data?.error ?? '회원가입에 실패했습니다.')
    } finally {
      setRegLoading(false)
    }
  }

  const switchToLogin = () => {
    setTab('login')
    setRegSuccess(false)
    setRegError(null)
  }

  return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-white mb-6 text-center">Synapse Message Interface</h1>

        {/* 탭 */}
        <div className="flex mb-6 bg-slate-900 rounded-lg p-1">
          <button
            onClick={() => { setTab('login'); setError(null) }}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'login' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            로그인
          </button>
          <button
            onClick={() => { setTab('register'); setRegSuccess(false); setRegError(null) }}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'register' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            회원가입
          </button>
        </div>

        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">아이디</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        )}

        {tab === 'register' && (
          regSuccess ? (
            <div className="space-y-4 text-center">
              <p className="text-green-400 text-sm">가입이 완료됐습니다.<br />어드민 권한은 관리자에게 요청하세요</p>
              <button
                onClick={switchToLogin}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-colors"
              >
                로그인하기
              </button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">아이디</label>
                <input
                  type="text"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">비밀번호 확인</label>
                <input
                  type="password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              {regError && <p className="text-red-400 text-sm">{regError}</p>}
              <p className="text-slate-500 text-xs">가입 후 일반 권한으로 등록됩니다. 관리자가 권한을 변경할 수 있습니다.</p>
              <button
                type="submit"
                disabled={regLoading}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
              >
                {regLoading ? '가입 중...' : '회원가입'}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  )
}
