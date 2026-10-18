import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, Input } from '../components/ui'
import { AuthLayout } from '../components/shell/AuthLayout'
import { useCloud, type SignupInput } from '../cloud/session'

const detected = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Public sign-up creates a new workspace. Members never sign up here; their coordinator or team lead creates their account. */
export default function Signup() {
  const cloud = useCloud()!
  const navigate = useNavigate()
  const [form, setForm] = useState<SignupInput>({ orgName: '', fullName: '', username: '', email: '', password: '', timezone: detected, role: 'coordinator' })
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof SignupInput | 'confirm', string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(false)
  const set = (k: keyof SignupInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // A new workspace starts on the import page; someone already signed in goes to their dashboard
  if (cloud.status === 'signed_in') return <Navigate to={created ? '/setup' : '/dashboard'} replace />

  function validate() {
    const e: typeof errors = {}
    if (!form.orgName.trim()) e.orgName = 'Name your workspace'
    if (!form.fullName.trim()) e.fullName = 'Enter your name'
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(form.username)) e.username = '3 to 32 letters, numbers, dots, dashes or underscores'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'
    if (form.password.length < 10 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) e.password = 'At least 10 characters with a letter and a number'
    if (confirm !== form.password) e.confirm = 'The passwords do not match'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    setBusy(true)
    setError('')
    setCreated(true)
    const res = await cloud.signUp({ ...form, username: form.username.toLowerCase() })
    setBusy(false)
    if (!res.ok) {
      setCreated(false)
      setError(res.error.message)
      return
    }
    navigate('/setup', { replace: true })
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
        <h1 className="font-dot text-4xl leading-tight text-white sm:text-5xl">Create a workspace</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">For the Coordinator / Team Lead. Team members join from the sign-in page with "Join as a team member".</p>
      </div>
      <form onSubmit={submit} className="glass-surface mx-auto flex max-w-lg flex-col gap-4 rounded-[28px] p-6" noValidate>
        <p className="text-xs text-white/60">You become the workspace's Coordinator / Team Lead: you approve join requests, assign tasks and review reminders.</p>
        <Input label="Workspace name" value={form.orgName} onChange={set('orgName')} error={errors.orgName} placeholder="Acme launch team" />
        <Input label="Description (optional)" value={form.description ?? ''} onChange={set('description')} placeholder="What this team works on" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Your full name" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
          <Input label="Username" autoComplete="username" value={form.username} onChange={set('username')} error={errors.username} placeholder="priya" />
        </div>
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
          <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        </div>
        <Input label="Timezone" value={form.timezone} onChange={set('timezone')} hint="Detected from your browser. Deadlines are read in each person's own timezone." />
        {error ? (
          <p role="alert" className="rounded-xl border border-status-overdue/40 px-3 py-2 text-sm text-status-overdue">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </AuthLayout>
  )
}
