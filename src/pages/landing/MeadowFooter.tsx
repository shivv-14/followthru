import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEngine } from '../../store'
import { MEADOW_POSTER, MEADOW_VIDEO, REPO_URL, prefersReducedMotion } from './media'

const COLUMNS = [
  {
    title: 'Product',
    menu: true,
    links: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Draft queue', to: '/queue' },
      { label: 'Commitments', to: '/commitments' },
      { label: 'Follow-up flows', to: '/flows' },
      { label: 'Team', to: '/team' },
    ],
  },
  {
    title: 'Proof',
    links: [
      { label: 'Scorecard', to: '/evidence' },
      { label: 'Audit trail', to: '/evidence' },
      { label: 'Health check', href: '/api/health' },
      { label: 'Evidence API', href: '/api/evidence?format=json&kind=scorecard' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'Source code', href: REPO_URL },
      { label: 'Set up data', to: '/setup' },
      { label: 'Style guide', to: '/styleguide' },
    ],
  },
]

export function MeadowFooter() {
  const { dataset, user } = useEngine()
  const appHref = dataset && user ? '/dashboard' : '/setup'
  const ref = useRef<HTMLElement>(null)
  const clip = useRef<HTMLVideoElement>(null)
  const [nearby, setNearby] = useState(false)
  const reduced = prefersReducedMotion()

  // Load the meadow footage only when the footer is close to the viewport
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !ref.current) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && (setNearby(true), io.disconnect()), { rootMargin: '400px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  // Same muted-attribute workaround as the hero so the meadow actually plays
  useEffect(() => {
    const v = clip.current
    if (!v || !nearby || reduced) return
    v.muted = true
    v.play?.()?.catch(() => {})
  }, [nearby, reduced])

  return (
    <footer className="mf" id="contact" ref={ref}>
      <div className="mf__stage" aria-hidden>
        <video
          ref={clip}
          className="mf__video"
          src={nearby && !reduced ? MEADOW_VIDEO : undefined}
          poster={MEADOW_POSTER}
          autoPlay={!reduced}
          muted
          loop
          playsInline
          preload="none"
        />
      </div>
      <p className="mf__wordmark" aria-hidden>
        FollowThru
      </p>
      <div className="mf__fog" aria-hidden />
      <div className="mf__content" id="proof">
        <div className="brand">
          <a className="brand__logo" href="#top" aria-label="FollowThru home">
            <span className="brand__mark" />
            FollowThru
          </a>
          <h2 className="brand__title">The calm queue for project coordinators</h2>
          <p className="brand__text">
            FollowThru reads team conversations, keeps owner, deadline and status right across every thread, and drafts one reminder per overdue commitment. Done, cancelled and deferred work is
            never chased, and a coordinator reviews every draft before anything goes out.
          </p>
          <Link className="brand__cta" to={appHref}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5 10 17 19 7" />
            </svg>
            Open the app
          </Link>
          <p className="brand__copy">© 2026 FollowThru · Fynd × NMIMS Hyderabad, Challenge C14</p>
          <p className="brand__by">
            Built with <span className="brand__heart" aria-label="love">💙</span> by
            <span className="brand__author">
              <span className="brand__avatar" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <rect width="24" height="24" fill="#e6e6e3" />
                  <circle cx="12" cy="9.2" r="4.4" fill="#1b1b1b" />
                  <path d="M3 25c0-6 4-9.4 9-9.4S21 19 21 25Z" fill="#1b1b1b" />
                </svg>
              </span>
              the FollowThru team
            </span>
          </p>
          <ul className="brand__status" aria-label="FollowThru status">
            <li className="chip">
              <span className="chip__dot" aria-hidden />
              Shadow mode · nothing sent
            </li>
            <li className="chip">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
              Works offline
            </li>
            <li className="chip">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8Z" />
              </svg>
              Rules engine, no AI needed
            </li>
          </ul>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} className={`col${col.menu ? ' col--menu' : ''}`} aria-label={col.title}>
            <h3 className="col__title">{col.title}</h3>
            <ul className="col__list">
              {col.links.map((l) => (
                <li key={l.label}>{'to' in l && l.to ? <Link to={l.to}>{l.label}</Link> : <a href={'href' in l ? l.href : '#'}>{l.label}</a>}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  )
}
