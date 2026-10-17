import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-black px-4 text-center">
      <div className="app-backdrop" aria-hidden />
      <h1 className="font-dot text-5xl text-white sm:text-7xl">Page not found</h1>
      <Link to="/" className="pill-glow rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">
        Back to the landing page
      </Link>
    </main>
  )
}
