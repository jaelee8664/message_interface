import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

interface Props {
  children: React.ReactNode
  requireSuperAdmin?: boolean
}

export default function ProtectedRoute({ children, requireSuperAdmin = false }: Props) {
  const { token, role } = useAuthStore()

  if (!token || !role) return <Navigate to="/login" replace />
  if (requireSuperAdmin && role !== 'SUPER_ADMIN') return <Navigate to="/" replace />

  return <>{children}</>
}
