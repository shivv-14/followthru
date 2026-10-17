import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-3xl font-semibold text-text-primary">Page not found</h1>
      <Link to="/" className="text-accent hover:underline">
        Back to the landing page
      </Link>
    </main>
  )
}
