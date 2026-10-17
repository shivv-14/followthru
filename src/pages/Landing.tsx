import { Link } from 'react-router-dom'
import { Stage } from '../three/Stage'

export default function Landing() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden px-4 text-center">
      <Stage className="absolute inset-0 -z-10 opacity-60" label="Status visualization" />
      <h1 className="font-display text-4xl font-semibold tracking-tight text-text-primary sm:text-6xl">
        Chase what's late.
        <br />
        Never what's done.
      </h1>
      <p className="max-w-md text-text-muted">
        A review queue that drafts the chase for you, and knows the moment it's already handled.
      </p>
      <Link
        to="/setup"
        className="mt-2 inline-flex h-12 items-center justify-center rounded-md bg-accent px-6 text-base font-medium text-white transition-colors duration-200 hover:bg-accent/90"
      >
        Open app
      </Link>
    </main>
  )
}
