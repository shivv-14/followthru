import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Role } from '../../engine/types'
import { useEngine } from '../../store'

/** Sends anyone without the role to their own tasks, with a short explanation. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useEngine()
  if (user && user.role !== role) {
    return <Navigate to="/team" replace state={{ notice: 'That page is for coordinators. Here are your tasks instead.' }} />
  }
  return <>{children}</>
}
