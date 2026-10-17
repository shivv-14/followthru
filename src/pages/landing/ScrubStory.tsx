import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SCRUB_VIDEO, prefersReducedMotion } from './media'

// Each panel owns a slice of this section's scroll as [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd].
// The gaps between one panel's fade-out and the next fade-in are deliberate dead zones (video only),
// so two panels are never readable at once.
const CUES = [
  [0.0, 0.0, 0.15, 0.23],
  [0.35, 0.43, 0.57, 0.65],
  [0.77, 0.85, 1.1, 1.2],
] as const
const DRIFT = 22 // px of counter-scroll travel per panel

const PANELS = [
  {
    eyebrow: ['How it works', 'Step 1'],
    title: ['Every promise,', 'tracked.'],
    sub: 'FollowThru reads requests, promises and replies across every thread, and keeps owner, deadline and status right through the whole history.',
    cta: { to: '/setup', label: 'Load the demo' },
  },
  {
    eyebrow: ['Silence is not done'],
    title: ['Quiet never', 'means finished.'],
    sub: 'No reply keeps the work open and the response pending. Only the owner, the requester or a coordinator can close it; anything unclear goes to a human.',
    cta: { to: '/evidence', label: 'See the evidence' },
  },
  {
    eyebrow: ['Only what is late'],
    title: ['One draft.', 'Never a duplicate.'],
    sub: 'Overdue work gets one reminder that updates in place. Done, cancelled and deferred work is never chased, and nothing is sent without review.',
    cta: { to: '/queue', label: 'Open the queue' },
  },
]

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const ramp = (p: number, a: number, b: number) => (b <= a ? (p >= b ? 1 : 0) : smooth(clamp((p - a) / (b - a), 0, 1)))

function PanelBody({ p }: { p: (typeof PANELS)[number] }) {
  return (
    <>
      <p className="sc-eyebrow">
        {p.eyebrow.map((e, i) => (
          <span key={e}>
            {i > 0 ? <span aria-hidden>&middot; </span> : null}
            {e}
          </span>
        ))}
      </p>
      <h2 className="sc-title">
        {p.title[0]}
        <br />
        {p.title[1]}
      </h2>
      <p className="sc-sub">{p.sub}</p>
      <div className="sc-cta">
        <Link className="sc-pill" to={p.cta.to}>
          {p.cta.label}
        </Link>
      </div>
    </>
  )
}

export function ScrubStory() {
  const [reduced] = useState(prefersReducedMotion)
  const section = useRef<HTMLElement>(null)
  const clip = useRef<HTMLVideoElement>(null)
  const meter = useRef<HTMLElement>(null)
  const panels = useRef<(HTMLDivElement | null)[]>([])
  const [loadPct, setLoadPct] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const video = clip.current
    if (reduced || !video || typeof window.matchMedia !== 'function') return
    let progress = 0
    let seekTo = 0
    let seekAt = 0
    let duration = 0
    let isReady = false
    let started = false
    let attached = false
    let raf = 0
    let objectUrl = ''
    let disposed = false
    const timers: number[] = []

    const readScroll = () => {
      const el = section.current
      if (!el) return
      const max = el.offsetHeight - window.innerHeight
      const top = el.getBoundingClientRect().top
      progress = max > 0 ? clamp(-top / max, 0, 1) : 0
      if (duration) seekTo = progress * duration
    }

    const paint = () => {
      if (meter.current) meter.current.style.transform = `scaleX(${progress})`
      panels.current.forEach((el, i) => {
        if (!el) return
        const c = CUES[i]
        const enter = ramp(progress, c[0], c[1])
        const leave = ramp(progress, c[2], c[3])
        const o = enter * (1 - leave)
        el.style.opacity = String(o)
        el.style.transform = `translate3d(0,${(1 - enter) * DRIFT - leave * DRIFT}px,0)`
        el.style.pointerEvents = o > 0.6 ? 'auto' : 'none'
      })
    }

    const frame = () => {
      if (isReady && duration) {
        const gap = seekTo - seekAt
        if (Math.abs(gap) > 0.0008) {
          // Easing currentTime toward the scroll target, rather than snapping, turns a jumpy scrub into a smooth one
          seekAt += gap * 0.115
          if (video.readyState >= 2 && !video.seeking) {
            try {
              video.currentTime = seekAt
            } catch {
              /* seeking before metadata is harmless */
            }
          }
        }
      }
      paint()
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (started || disposed) return
      started = true
      isReady = true
      setReady(true)
      readScroll()
      seekAt = seekTo
    }

    const attach = (src: string) => {
      if (attached || disposed) return
      attached = true
      video.addEventListener('loadedmetadata', () => {
        duration = video.duration || 0
        video.pause()
        readScroll()
        seekAt = seekTo
        try {
          video.currentTime = seekAt
        } catch {
          /* ignore */
        }
      })
      video.addEventListener('loadeddata', start)
      video.addEventListener('canplaythrough', start)
      video.addEventListener('error', start)
      video.src = src
      video.load()
      timers.push(window.setTimeout(start, 12000)) // never strand the section behind the loader
    }

    // Fetch the whole file as a blob first: seeking inside a buffered blob is near instant,
    // while range requests over the network turn the scrub into a slideshow.
    const preload = () => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
      const bail = window.setTimeout(() => {
        if (attached) return
        controller?.abort()
        setLoadPct(1)
        attach(SCRUB_VIDEO)
      }, 15000)
      timers.push(bail)
      fetch(SCRUB_VIDEO, { signal: controller?.signal })
        .then((res) => {
          if (!res.ok || !res.body) throw new Error('no body')
          const total = Number(res.headers.get('content-length')) || 0
          const reader = res.body.getReader()
          const chunks: BlobPart[] = []
          let got = 0
          const pump = (): Promise<Blob> =>
            reader.read().then((r) => {
              if (r.done) return new Blob(chunks, { type: 'video/mp4' })
              chunks.push(r.value as BlobPart)
              got += r.value.length
              setLoadPct(total ? got / total : Math.min(got / 11e6, 0.95))
              return pump()
            })
          return pump()
        })
        .then((blob) => {
          clearTimeout(bail)
          if (disposed) return
          setLoadPct(1)
          objectUrl = URL.createObjectURL(blob)
          attach(objectUrl)
        })
        .catch(() => {
          clearTimeout(bail)
          setLoadPct(1)
          attach(SCRUB_VIDEO) // CORS failure, abort or offline: stream directly instead
        })
    }

    // iOS will not paint a frame from a video that has never played, so nudge it once on the first interaction.
    const unlock = () => {
      try {
        const p = video.play()
        if (p && typeof p.then === 'function') p.then(() => video.pause()).catch(() => {})
        else video.pause()
      } catch {
        /* play() is not available everywhere */
      }
    }
    const unlockEvents = ['touchstart', 'pointerdown', 'wheel', 'keydown'] as const
    unlockEvents.forEach((ev) => window.addEventListener(ev, unlock, { once: true, passive: true }))

    // Only start downloading when the section is close to the viewport
    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined' && section.current) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect()
            preload()
          }
        },
        { rootMargin: '600px 0px' },
      )
      io.observe(section.current)
    } else preload()

    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('resize', readScroll)
    readScroll()
    paint()
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      io?.disconnect()
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      unlockEvents.forEach((ev) => window.removeEventListener(ev, unlock))
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', readScroll)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reduced])

  if (reduced) {
    return (
      <section className="sc sc--static" id="story" aria-label="How FollowThru works">
        {PANELS.map((p) => (
          <div key={p.title.join(' ')} className="sc-panel sc-panel--static">
            <PanelBody p={p} />
          </div>
        ))}
      </section>
    )
  }

  return (
    <section className="sc" id="story" ref={section} aria-label="How FollowThru works">
      <div className="sc-stage">
        <video ref={clip} className="sc-video" muted playsInline preload="auto" disablePictureInPicture aria-hidden />
        <div className="sc-veil" aria-hidden />
        <div className="sc-grain" aria-hidden />
        <i className="sc-meter" ref={meter} aria-hidden />
        <div className={`sc-boot${ready ? ' is-done' : ''}`} aria-hidden={ready}>
          <div className="sc-bar">
            <i style={{ transform: `scaleX(${loadPct})` }} />
          </div>
          <p>LOADING {Math.round(loadPct * 100)}%</p>
        </div>
        <div className="sc-panels">
          {PANELS.map((p, i) => (
            <div
              key={p.title.join(' ')}
              className="sc-panel"
              ref={(el) => {
                panels.current[i] = el
              }}
            >
              <PanelBody p={p} />
            </div>
          ))}
        </div>
        <p className="sc-foot">Shadow mode &nbsp;&middot;&nbsp; nothing is ever sent without review</p>
      </div>
    </section>
  )
}
