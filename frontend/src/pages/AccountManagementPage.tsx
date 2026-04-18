import { useEffect, useState } from 'react'
import axios from 'axios'
import { AccountRole } from '../store/authStore'

interface AccountDto {
  id: string
  username: string
  role: AccountRole
}

const ROLE_LABELS: Record<AccountRole, string> = {
  SUPER_ADMIN: '슈퍼어드민',
  ADMIN: '어드민',
  GENERAL: '일반',
}

const ROLE_COLORS: Record<AccountRole, string> = {
  SUPER_ADMIN: 'text-yellow-400',
  ADMIN: 'text-blue-400',
  GENERAL: 'text-slate-400',
}

export default function AccountManagementPage() {
  const [accounts, setAccounts] = useState<AccountDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createUsername, setCreateUsername] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<AccountRole>('GENERAL')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<AccountDto | null>(null)
  const [editPassword, setEditPassword] = useState('')
  const [editRole, setEditRole] = useState<AccountRole>('GENERAL')
  const [editError, setEditError] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(false)

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/synapse/auth/accounts')
      setAccounts(res.data.data ?? [])
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAccounts() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreateLoading(true)
    try {
      await axios.post('/synapse/auth/accounts', {
        username: createUsername,
        password: createPassword,
        role: createRole,
      })
      setShowCreate(false)
      setCreateUsername('')
      setCreatePassword('')
      setCreateRole('GENERAL')
      await fetchAccounts()
    } catch (e: any) {
      setCreateError(e.response?.data?.error ?? e.message)
    } finally {
      setCreateLoading(false)
    }
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    setEditError(null)
    setEditLoading(true)
    try {
      await axios.put(`/synapse/auth/accounts/${editTarget.id}`, {
        password: editPassword || undefined,
        role: editRole,
      })
      setEditTarget(null)
      setEditPassword('')
      await fetchAccounts()
    } catch (e: any) {
      setEditError(e.response?.data?.error ?? e.message)
    } finally {
      setEditLoading(false)
    }
  }

  const handleDelete = async (account: AccountDto) => {
    if (!confirm(`"${account.username}" 계정을 삭제하시겠습니까?`)) return
    try {
      await axios.delete(`/synapse/auth/accounts/${account.id}`)
      await fetchAccounts()
    } catch (e: any) {
      alert(e.response?.data?.error ?? e.message)
    }
  }

  const openEdit = (account: AccountDto) => {
    setEditTarget(account)
    setEditPassword('')
    setEditRole(account.role)
    setEditError(null)
  }

  if (loading) return <div className="p-6 text-slate-400">로딩 중...</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-white">계정 관리</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium"
          >
            + 계정 추가
          </button>
        </div>

        <div className="space-y-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3"
            >
              <div>
                <span className="text-white font-medium">{account.username}</span>
                <span className={`ml-3 text-sm ${ROLE_COLORS[account.role]}`}>
                  {ROLE_LABELS[account.role]}
                </span>
              </div>
              {account.role !== 'SUPER_ADMIN' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(account)}
                    className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(account)}
                    className="px-3 py-1 text-xs bg-red-800 hover:bg-red-700 text-white rounded"
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 계정 생성 모달 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-lg mb-4">계정 추가</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm text-slate-400 mb-1">아이디</label>
                <input
                  type="text"
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">비밀번호</label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">역할</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as AccountRole)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="ADMIN">어드민</option>
                  <option value="GENERAL">일반</option>
                </select>
              </div>
              {createError && <p className="text-red-400 text-sm">{createError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm"
                >
                  {createLoading ? '생성 중...' : '생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 계정 수정 모달 */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-lg mb-1">계정 수정</h2>
            <p className="text-slate-400 text-sm mb-4">{editTarget.username}</p>
            <form onSubmit={handleEdit} className="space-y-3">
              <div>
                <label className="block text-sm text-slate-400 mb-1">새 비밀번호 (변경 시만 입력)</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="변경하지 않으려면 비워두세요"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-600"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">역할</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as AccountRole)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="ADMIN">어드민</option>
                  <option value="GENERAL">일반</option>
                </select>
              </div>
              {editError && <p className="text-red-400 text-sm">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm"
                >
                  {editLoading ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
