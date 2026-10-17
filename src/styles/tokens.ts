// Design tokens for FollowThru. Source of truth for any value used outside
// Tailwind utility classes (Framer Motion transitions, R3F materials, canvas
// fallbacks). CSS-side equivalents live in ./global.css under @theme and
// must be kept in sync by hand when a value here changes.

export const color = {
  bg: '#07060D',
  surface: 'rgba(255, 255, 255, 0.04)',
  surfaceHover: 'rgba(255, 255, 255, 0.07)',
  surfaceBorder: 'rgba(255, 255, 255, 0.08)',
  accent: '#8B6FFF',
  accentMuted: 'rgba(124, 92, 255, 0.32)',
  accentStrong: '#6A4BEF',
  textPrimary: '#F5F4F8',
  textMuted: 'rgba(245, 244, 248, 0.64)',
  textFaint: 'rgba(245, 244, 248, 0.58)',
  status: {
    done: '#3EE6B0',
    overdue: '#FF5D6C',
    tentative: '#FFB547',
    deferred: '#5CC8FF',
    cancelled: '#8A8799',
    open: '#F5F4F8',
  },
} as const

export type StatusColorKey = keyof typeof color.status

export const font = {
  display: "'Space Grotesk Variable', 'Space Grotesk', sans-serif",
  body: "'Inter Variable', 'Inter', sans-serif",
} as const

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '24px',
  full: '9999px',
} as const

export const shadow = {
  glass: '0 1px 1px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.36)',
  glow: '0 0 0 1px rgba(124, 92, 255, 0.4), 0 0 24px rgba(124, 92, 255, 0.28)',
} as const

export const focusRing = {
  width: '2px',
  offset: '2px',
  color: color.accent,
} as const

export const motion = {
  duration: {
    fast: 0.12,
    base: 0.2,
    slow: 0.36,
    slower: 0.6,
  },
  spring: {
    snappy: { type: 'spring', stiffness: 420, damping: 32 },
    soft: { type: 'spring', stiffness: 220, damping: 26 },
    gentle: { type: 'spring', stiffness: 120, damping: 20 },
  },
} as const

// min-width breakpoints, px. 360 is the minimum supported width, not a
// breakpoint start — layouts must already work there without a query.
export const breakpoint = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const
