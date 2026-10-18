import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LockKeyhole } from 'lucide-react'
import { Button, Dialog, Input } from '../components/ui'
import { AuthLayout } from '../components/shell/AuthLayout'
import { useCloud } from '../cloud/session'
import { supabase } from '../lib/supabase'

/** Real sign-in (Supabase Auth). Accepts a username or an email address. */
export default function CloudLogin() {
  const cloud = useCloud()!
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetNote, setResetNote] = useState('')

  if (cloud.status === 'signed_in' && cloud.me) {
    return <Navigate to={cloud.me.profile.mustChangePassword ? '/change-password' : from === '/login' ? '/dashboard' : from} replace />
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!identifier.trim() || !password) {
      setError('Enter your username or email and your password')
      return
    }
    setBusy(true)
    setError('')
    const res = await cloud.signIn(identifier.trim(), password)
    setBusy(false)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    navigate(res.data.mustChangePassword ? '/change-password' : from, { replace: true })
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault()
    const { error: err } = await supabase().auth.resetPasswordForEmail(resetEmail.trim(), { redirectTo: `${window.location.origin}/change-password` })
    // Same answer whether or not the address has an account
    setResetNote(err ? 'The reset email could not be sent right now. Ask your coordinator to reset your password.' : 'If that address has an account, a reset link is on its way. Check your inbox and spam folder.')
  }

  return (
    <AuthLayout
    >
      <div className="mb-8 text-center">
        <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-pill-border bg-pill/90 px-4 py-1.5 text-xs font-medium text-[#c4c2c3]">
          <LockKeyhole size={14} aria-hidden /> Secure sign-in · your workspace is saved in the cloud
        </p>
        <h1 className="font-dot text-5xl leading-tight text-white sm:text-6xl">Sign in</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/75">Use your username or email and password.</p>
      </div>
      <form onSubmit={submit} className="glass-surface mx-auto flex max-w-md flex-col gap-4 rounded-[28px] p-6" noValidate>
        <Input label="Username or email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="priya or priya@company.com" />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? (
          <p role="alert" className="rounded-xl border border-status-overdue/40 px-3 py-2 text-sm text-status-overdue">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <button type="button" className="self-start text-sm text-white/70 hover:text-white" onClick={() => setForgot(true)}>
          Forgot password?
        </button>
      </form>
      <div className="mx-auto mt-4 grid max-w-md gap-3 sm:grid-cols-2">
        <Link to="/join" className="glass-surface rounded-[22px] p-4 text-center hover:bg-white/[0.07]">
          <span className="block text-sm font-semibold text-white">Join as a team member</span>
          <span className="mt-1 block text-xs text-white/60">Make an account, then ask to join your team's workspace</span>
        </Link>
        <Link to="/signup" className="glass-surface rounded-[22px] p-4 text-center hover:bg-white/[0.07]">
          <span className="block text-sm font-semibold text-white">Create a workspace</span>
          <span className="mt-1 block text-xs text-white/60">For the Coordinator / Team Lead who runs the team</span>
        </Link>
      </div>
      <p className="mt-6 text-center text-xs text-white/55">Reminders appear inside FollowThru only; nothing is emailed or texted.</p>

      <Dialog open={forgot} onClose={() => setForgot(false)} title="Forgot your password?" variant="modal">
        <p className="mb-3 text-sm text-text-muted">The fastest way: ask your coordinator or team lead to reset it. They get a temporary password to give you, and you choose a new one when you sign in.</p>
        <form onSubmit={sendReset} className="flex flex-col gap-3">
          <Input label="Or send a reset link to your email" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@company.com" />
          <Button type="submit" variant="secondary" disabled={!resetEmail.trim()}>
            Send reset link
          </Button>
          {resetNote ? <p className="text-sm text-text-muted">{resetNote}</p> : null}
          <p className="text-xs text-text-faint">Reset emails only work for accounts with a real email address, and depend on the workspace's email settings in Supabase.</p>
        </form>
      </Dialog>
    </AuthLayout>
  )
}
