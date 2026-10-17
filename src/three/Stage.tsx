import { Suspense, lazy, useEffect, useState } from 'react'
import { Fallback2D } from './Fallback2D'
import { hasWebGL, prefersReducedMotion } from './webgl'

const SceneCanvas = lazy(() => import('./SceneCanvas'))

export interface StageProps {
  maxDpr?: number
  label?: string
  className?: string
}

/** Reusable 3D canvas wrapper. Lazy loads three.js, caps device pixel ratio,
 * and renders a static 2D fallback when WebGL is unavailable or the user
 * prefers reduced motion — never both the canvas and the fallback at once. */
export function Stage({ maxDpr = 1.5, label, className }: StageProps) {
  const [canRender3D, setCanRender3D] = useState<boolean | null>(null)

  useEffect(() => {
    setCanRender3D(hasWebGL() && !prefersReducedMotion())
  }, [])

  if (canRender3D === null) {
    return <div className={className} aria-hidden />
  }

  if (!canRender3D) {
    return (
      <div className={className}>
        <Fallback2D label={label} />
      </div>
    )
  }

  return (
    <div className={className}>
      <Suspense fallback={<Fallback2D label={label} />}>
        <SceneCanvas maxDpr={maxDpr} />
      </Suspense>
    </div>
  )
}
