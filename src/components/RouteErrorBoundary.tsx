import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Button, Dialog } from './ui'
import { useActions } from '../store'

function ErrorScreen({ error }: { error: Error }) {
  const actions = useActions()
  const [confirm, setConfirm] = useState(false)
  return (
    <main role="alert" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-2xl font-semibold text-text-primary">Something went wrong on this page</h1>
      <p className="text-sm text-text-muted">Your data is still saved on this device. Reload to try again.</p>
      <p className="max-w-full break-words font-mono text-xs text-text-faint">{error.message}</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          Reset local data
        </Button>
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Reset all local data?" variant="modal">
        <p className="mb-4 text-sm text-text-muted">This deletes the data, drafts, decisions, tasks, flows, runs and uploads in this browser. The audit log is kept.</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            onClick={async () => {
              await actions.resetAll()
              window.location.assign('/login')
            }}
          >
            Reset
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep data
          </Button>
        </div>
      </Dialog>
    </main>
  )
}

/** Catches a crash in one page so the rest of the app, and the user's data, stay usable. */
export class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the details available in the browser console for debugging
    console.error(error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    return this.state.error ? <ErrorScreen error={this.state.error} /> : this.props.children
  }
}
