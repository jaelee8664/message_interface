import { create } from 'zustand'
import axios from 'axios'

export type AccountRole = 'SUPER_ADMIN' | 'ADMIN' | 'GENERAL'

interface AuthState {
  token: string | null
  username: string | null
  role: AccountRole | null
  initialized: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  init: () => Promise<void>
  canWrite: () => boolean
  isSuperAdmin: () => boolean
}

const TOKEN_KEY = 'synapse_token'

function parseJwtPayload(token: string): { sub: string; role: AccountRole } | null {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  username: null,
  role: null,
  initialized: false,

  init: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { set({ initialized: true }); return }
    const payload = parseJwtPayload(token)
    if (!payload) { localStorage.removeItem(TOKEN_KEY); set({ initialized: true }); return }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    try {
      await axios.get('/synapse/auth/me')
      set({ token, username: payload.sub, role: payload.role, initialized: true })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      delete axios.defaults.headers.common['Authorization']
      set({ token: null, username: null, role: null, initialized: true })
    }
  },

  login: async (username, password) => {
    const res = await axios.post('/synapse/auth/login', { username, password })
    const { token, username: uname, role } = res.data.data
    localStorage.setItem(TOKEN_KEY, token)
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    set({ token, username: uname, role })
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    delete axios.defaults.headers.common['Authorization']
    set({ token: null, username: null, role: null })
  },

  canWrite: () => {
    const role = get().role
    return role === 'SUPER_ADMIN' || role === 'ADMIN'
  },

  isSuperAdmin: () => get().role === 'SUPER_ADMIN',
}))
