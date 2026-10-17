import { Link, useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, Button, EmptyState } from '../components/ui'
import { useActions, useEngine } from '../store'

const roleText = {
  coordinator: 'Coordinator: reviews drafts, confirms recipients, approves in shadow mode, assigns tasks.',
  member: 'Member: sees their own tasks, updates progress, reports blockers, submits work.',
}

export default function ProfilePicker() {
  const navigate = useNavigate()
  const { dataset, ready, user } = useEngine()
  const actions = useActions()

  if (ready && !dataset) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <EmptyState title="No data yet" description="Load the challenge fixture, a file, or the demo data first." action={{ label: 'Go to setup', onClick: () => navigate('/setup') }} />
      </main>
    )
  }

  const people = [...(dataset?.data.people ?? [])].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'coordinator' ? -1 : 1))

  async function choose(id: string) {
    await actions.updateSettings({ profileId: id })
    navigate('/dashboard')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4 py-10">
      <div className="mb-2 text-center">
        <h1 className="font-display text-2xl font-semibold text-text-primary">Choose a profile</h1>
        <p className="text-sm text-text-muted">Local demo profiles from the loaded data. There is no real login.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <Card key={p.id} className={user?.id === p.id ? 'shadow-glow' : undefined}>
            <CardHeader>
              <CardTitle>{p.name}</CardTitle>
              <span className="text-xs text-text-faint">{p.role ?? 'member'}</span>
            </CardHeader>
            <p className="mb-3 text-xs text-text-muted">
              {roleText[p.role ?? 'member']} · {p.timezone}
            </p>
            <Button className="w-full" variant={p.role === 'coordinator' ? 'primary' : 'secondary'} onClick={() => choose(p.id)}>
              Continue as {p.name.split(/\s+/)[0]}
            </Button>
          </Card>
        ))}
      </div>
      {people.length > 0 && !people.some((p) => p.role === 'coordinator') ? (
        <p className="text-center text-sm text-status-tentative">No one in this data has the coordinator role, so drafts cannot be approved.</p>
      ) : null}
      <Link to="/setup" className="text-center text-sm text-text-muted hover:text-text-primary">
        Change data
      </Link>
    </main>
  )
}
