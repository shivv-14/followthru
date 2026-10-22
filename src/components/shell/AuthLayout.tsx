import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { HERO_VIDEO, prefersReducedMotion } from '../../pages/landing/media'

/** Full-screen landing look (hero video, veil, logo pill) for sign-in and setup. */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null)
  const reduced = prefersReducedMotion()

  // React does not render the muted attribute, so set it before asking to play
  useEffect(() => {
    const v = video.current
    if (!v || reduced) return
    v.muted = true
    v.play?.()?.catch(() => {})
  }, [reduced])

  return (
    <div className="relative min-h-dvh overflow-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <video ref={video} className="size-full object-cover opacity-70" autoPlay={!reduced} muted loop playsInline preload={reduced ? 'none' : 'auto'}>
          <source src={HERO_VIDEO} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_45%,rgba(0,0,0,0.35),rgba(0,0,0,0.85))]" />
      </div>
      <header className="relative z-10 flex items-center justify-between px-4 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3" aria-label="FollowThru home">
          <span className="grid size-11 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.16)]">
            <img src="/logo.svg" alt="" width={32} height={32} className="rounded-[22%]" />
          </span>
          <span className="hidden text-sm font-medium text-white/90 sm:inline">FollowThru</span>
        </Link>
        {aside}
      </header>
      <main className="app-enter relative z-10 mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:pt-10">{children}</main>
    </div>
  )
}
