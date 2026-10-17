import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, Button } from '../components/ui'

const profiles = [
  { id: 'coordinator', name: 'Priya', role: 'Coordinator', description: 'Reviews drafts and approves in shadow mode.' },
  { id: 'member', name: 'Dev', role: 'Member', description: 'Owns and completes assigned commitments.' },
] as const

export default function ProfilePicker() {
  const navigate = useNavigate()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <div className="mb-2 text-center">
        <h1 className="font-display text-2xl font-semibold text-text-primary">Choose a profile</h1>
        <p className="text-sm text-text-muted">Demo profiles — no real authentication.</p>
      </div>
      {profiles.map((profile) => (
        <Card key={profile.id}>
          <CardHeader>
            <CardTitle>
              {profile.name} — {profile.role}
            </CardTitle>
          </CardHeader>
          <p className="mb-3 text-sm text-text-muted">{profile.description}</p>
          <Button className="w-full" onClick={() => navigate('/dashboard')}>
            Continue as {profile.name}
          </Button>
        </Card>
      ))}
    </main>
  )
}
