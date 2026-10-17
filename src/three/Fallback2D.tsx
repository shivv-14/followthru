export interface Fallback2DProps {
  label?: string
}

/** Static, still-informative stand-in for the 3D scene. Used when WebGL is
 * unavailable or the user prefers reduced motion. No animation, no WebGL. */
export function Fallback2D({ label }: Fallback2DProps) {
  return (
    <div
      role="img"
      aria-label={label ?? 'Decorative status visualization'}
      className="flex size-full items-center justify-center rounded-lg"
      style={{
        background:
          'radial-gradient(circle at 50% 50%, rgba(124,92,255,0.35), rgba(7,6,13,0) 70%)',
      }}
    >
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        <polygon
          points="48,8 86,30 86,66 48,88 10,66 10,30"
          fill="none"
          stroke="#7C5CFF"
          strokeWidth="1.5"
          opacity="0.8"
        />
      </svg>
    </div>
  )
}
