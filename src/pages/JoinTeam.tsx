import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/ui'
import { AuthLayout } from '../components/shell/AuthLayout'
import { useCloud, type MemberSignupInput } from '../cloud/session'

const detected = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Team member sign-up. After this they pick a workspace and ask to join; a coordinator approves. */
export default function JoinTeam() {
  const cloud = useCloud()!
  const navigate = useNavigate()
  const [form, setForm] = useState<MemberSignupInput>({ fullName: '', username: '', email: '', password: '', timezone: detected })
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(false)
  const set = (k: keyof MemberSignupInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (cloud.status === 'signed_in') return <Navigate to={created ? '/workspaces' : '/dashboard'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.fullName.trim()) return setError('Enter your name')
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(form.username)) return setError('Usernames are 3 to 32 letters, numbers, dots, dashes or underscores')
    if (form.password.length < 10 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return setError('Use a password of at least 10 characters with a letter and a number')
    if (form.password !== confirm) return setError('The passwords do not match')
    setBusy(true)
    setError('')
    setCreated(true)
    const res = await cloud.signUpMember({ ...form, username: form.username.toLowerCase() })
    setBusy(false)
    if (!res.ok) {
      setCreated(false)
      return setError(res.error.message)
    }
    navigate('/workspaces', { replace: true })
  }

  return (
    <AuthLayout
      aside={
        <Link to="/login" className="rounded-full bg-pill px-5 py-2.5 text-sm font-medium text-pill-text shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:bg-[#323234] hover:text-white">
          Sign in
        </Link>
      }
    >
      <div className="mb-8 text-center">
        <h1 className="font-dot text-4xl leading-tight text-white sm:text-5xl">Join your team</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">Make your team member account. Next you choose your team's workspace and ask to join; your Coordinator / Team Lead approves it.</p>
      </div>
      <form onSubmit={submit} className="glass-surface mx-auto flex max-w-lg flex-col gap-4 rounded-[28px] p-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Your full name" autoComplete="name" value={form.fullName} onChange={set('fullName')} />
          <Input label="Username" autoComplete="username" value={form.username} onChange={set('username')} placeholder="ganesh" />
        </div>
        <Input label="Email (optional)" type="email" autoComplete="email" value={form.email} onChange={set('email')} hint="Leave empty to sign in with your username only" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Input label="Timezone" value={form.timezone} onChange={set('timezone')} hint="Detected from your browser" />
        {error ? (
          <p role="alert" className="rounded-xl border border-status-overdue/40 px-3 py-2 text-sm text-status-overdue">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create my account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
