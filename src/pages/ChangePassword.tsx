import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Input, LoadingState } from '../components/ui'
import { AuthLayout } from '../components/shell/AuthLayout'
import { useCloud } from '../cloud/session'

/** New password: required after a temporary password, and the landing page for email reset links. */
export default function ChangePassword() {
  const cloud = useCloud()!
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (cloud.status === 'loading') return <LoadingState label="Checking your session" />
  if (cloud.status === 'signed_out') return <Navigate to="/login" replace />
  const forced = cloud.me?.profile.mustChangePassword

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Use at least 10 characters with a letter and a number')
    if (password !== confirm) return setError('The passwords do not match')
    setBusy(true)
    const res = await cloud.changePassword(password)
    setBusy(false)
    if (!res.ok) return setError(res.error.message)
    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthLayout>
      <div className="mb-8 text-center">
        <h1 className="font-dot text-4xl leading-tight text-white sm:text-5xl">{forced ? 'Choose your password' : 'Change password'}</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">
          {forced ? 'You signed in with a temporary password. Choose your own to continue; your work stays hidden until you do.' : 'Choose a new password for your account.'}
        </p>
      </div>
      <form onSubmit={submit} className="glass-surface mx-auto flex max-w-md flex-col gap-4 rounded-[28px] p-6" noValidate>
        <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters with a letter and a number" />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error ? (
          <p role="alert" className="rounded-xl border border-status-overdue/40 px-3 py-2 text-sm text-status-overdue">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
        <button type="button" className="text-sm text-white/60 hover:text-white" onClick={() => void cloud.signOut().then(() => navigate('/login'))}>
          Sign out instead
        </button>
      </form>
    </AuthLayout>
  )
}
