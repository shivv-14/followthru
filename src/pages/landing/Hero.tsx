import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, Inbox, ShieldCheck } from 'lucide-react'
import { useEngine } from '../../store'
import { makeConfig, runEngine } from '../../engine'
import { deadlineState } from '../../engine/deadline'
import { validateDataset } from '../../schema/validate'
import demoDataset from '../../mocks/demoDataset.json'
import { InstallButton } from '../../components/shell/InstallButton'
import { HERO_VIDEO, prefersReducedMotion } from './media'

interface Stat {
  glyph: string
  target: number
  suffix: string
  decimals: number
  label: string
}

/** Real numbers from the engine: the loaded data, or the synthetic demo when nothing is loaded yet. */
function useLandingStats(): { stats: Stat[]; source: string } {
  const { dataset, result, now } = useEngine()
  return useMemo(() => {
    let r = result
    let at = now
    let source = dataset ? `${dataset.name}${dataset.source === 'demo' ? ' (synthetic)' : ''}` : 'the synthetic demo data'
    let zones = new Set((dataset?.data.people ?? []).map((p) => p.timezone)).size
    if (!dataset) {
      const demo = validateDataset(demoDataset).data!
      at = demo.referenceTime!
      r = runEngine({ dataset: demo }, makeConfig(at))
      zones = new Set(demo.people.map((p) => p.timezone)).size
      source = 'the synthetic demo data'
    }
    const overdue = r.commitments.filter((c) => c.status === 'open' && deadlineState(c.deadline, at) === 'overdue').length
    const closed = r.commitments.filter((c) => c.status !== 'open')
    const closedChased = closed.filter((c) => r.drafts.some((d) => d.commitmentId === c.id && (d.state === 'pending_review' || d.state === 'approved'))).length
    return {
      source,
      stats: [
        { glyph: '#', target: r.commitments.length, suffix: '', decimals: 0, label: 'Commitments tracked' },
        { glyph: '<', target: overdue, suffix: '', decimals: 0, label: 'Overdue, drafted for review' },
        { glyph: '*', target: closed.length - closedChased, suffix: `/${closed.length}`, decimals: 0, label: 'Closed items never chased' },
        { glyph: '%', target: zones, suffix: '', decimals: 0, label: 'Timezones read correctly' },
      ],
    }
  }, [dataset, result, now])
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function Stats() {
  const { stats, source } = useLandingStats()
  const ref = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<number[]>(() => stats.map((s) => (prefersReducedMotion() ? s.target : 0)))

  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setValues(stats.map((s) => s.target))
      return
    }
    let raf = 0
    const timers: number[] = []
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        stats.forEach((s, i) => {
          const duration = 1500 + i * 80
          timers.push(
            window.setTimeout(() => {
              const start = performance.now()
              const tick = (t: number) => {
                const p = Math.min(1, (t - start) / duration)
                setValues((v) => v.map((x, j) => (j === i ? s.target * easeOutCubic(p) : x)))
                if (p < 1) raf = requestAnimationFrame(tick)
              }
              raf = requestAnimationFrame(tick)
            }, 480 + i * 90),
          )
        })
      },
      { threshold: 0.25 },
    )
    if (ref.current) io.observe(ref.current)
    return () => {
      io.disconnect()
      timers.forEach(clearTimeout)
      cancelAnimationFrame(raf)
    }
  }, [stats])

  return (
    <section className="lh-stats" aria-label="FollowThru at a glance" ref={ref}>
      {stats.map((s, i) => (
        <div key={s.label} className="lh-stat anim" style={{ ['--d' as string]: `${0.5 + i * 0.08}s` }}>
          <span className="lh-stat__icon" aria-hidden>
            {s.glyph}
          </span>
          <span className="lh-stat__value">
            {(values[i] ?? 0).toFixed(s.decimals)}
            {s.suffix}
          </span>
          <span className="lh-stat__label">{s.label}</span>
        </div>
      ))}
      <p className="lh-stats__source">Counted live by the engine from {source}.</p>
    </section>
  )
}

const NAV = [
  { href: '#top', label: 'Home' },
  { href: '#story', label: 'How it works' },
  { href: '#proof', label: 'Proof' },
  { href: '#contact', label: 'Contact' },
]

function Header({ appHref }: { appHref: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    document.body.classList.toggle('menu-open', open)
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onResize = () => window.innerWidth > 720 && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      document.body.classList.remove('menu-open')
    }
  }, [open])

  return (
    <header className="lh-header">
      <a className="lh-logo" href="#top" aria-label="FollowThru home">
        <img src="/logo.svg" alt="" width={52} height={52} />
      </a>
      <nav className="lh-nav" aria-label="Landing">
        {NAV.map((n, i) => (
          <a key={n.href} href={n.href} className={i === 0 ? 'is-active' : undefined} aria-current={i === 0 ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <Link className="lh-signin" to={appHref}>
        Launch
      </Link>
      <button type="button" className={`lh-burger${open ? ' is-open' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="lh-menu" onClick={() => setOpen((v) => !v)}>
        <span />
        <span />
        <span />
      </button>
      {open ? <div className="lh-overlay" onClick={() => setOpen(false)} aria-hidden /> : null}
      <div id="lh-menu" className="lh-menu" hidden={!open}>
        {NAV.map((n, i) => (
          <a key={n.href} href={n.href} className={i === 0 ? 'is-active' : undefined} style={{ ['--i' as string]: i }} onClick={() => setOpen(false)}>
            {n.label}
          </a>
        ))}
        <Link className="lh-menu__signin" to={appHref} onClick={() => setOpen(false)}>
          Launch
        </Link>
      </div>
    </header>
  )
}

export function Hero() {
  const { dataset, user } = useEngine()
  const appHref = dataset && user ? '/dashboard' : '/setup'
  const reduced = prefersReducedMotion()
  const video = useRef<HTMLVideoElement>(null)

  // React does not render the muted attribute, so browsers treat the clip as audible and block autoplay
  useEffect(() => {
    const v = video.current
    if (!v || reduced) return
    v.muted = true
    v.play?.()?.catch(() => {})
  }, [reduced])

  return (
    <section className="lh" id="top" aria-labelledby="lh-title">
      <div className="lh-bg" aria-hidden>
        <video ref={video} className="lh-video" autoPlay={!reduced} muted loop playsInline preload={reduced ? 'none' : 'auto'}>
          <source src={HERO_VIDEO} type="video/mp4" />
        </video>
      </div>
      <div className="lh-page">
        <Header appHref={appHref} />
        <div className="lh-hero">
          <div className="lh-trust anim" style={{ ['--d' as string]: '0.05s' }}>
            <span className="lh-trust__avatar a1" aria-hidden>
              <span>
                <Clock3 />
              </span>
            </span>
            <span className="lh-trust__avatar a2" aria-hidden>
              <span>
                <Inbox />
              </span>
            </span>
            <span className="lh-trust__avatar a3" aria-hidden>
              <span>
                <ShieldCheck />
              </span>
            </span>
            <span className="lh-trust__pill">Fynd × NMIMS Hyderabad · Challenge C14</span>
          </div>
          <h1 className="lh-headline anim-none" id="lh-title">
            <span>Chase what's late.</span>
            <span>Never what's done.</span>
          </h1>
          <p className="lh-sub anim" style={{ ['--d' as string]: '0.28s' }}>
            FollowThru reads your team's conversations, tracks every promise across threads and timezones, and drafts a reminder only when work is really late.
          </p>
          <div className="lh-cta-row anim-pulse" style={{ ['--d' as string]: '0.4s' }}>
            <Link className="lh-cta" to={appHref}>
              Open app
            </Link>
            <InstallButton className="lh-install" />
          </div>
        </div>
        <Stats />
      </div>
    </section>
  )
}
