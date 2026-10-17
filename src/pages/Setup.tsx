import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Button, Card } from '../components/ui'

const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export default function Setup() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Enter your name to continue')
      return
    }
    setError('')
    navigate('/profiles')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-1 font-display text-2xl font-semibold text-text-primary">Set up FollowThru</h1>
      <p className="mb-6 text-sm text-text-muted">
        Fynd data import and validation connect to real engine data in a later phase.
      </p>
      <Card>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={error}
            placeholder="Priya Sharma"
          />
          <Input label="Timezone" value={detectedTimezone} readOnly hint="Detected automatically from your browser" />
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </form>
      </Card>
    </main>
  )
}
