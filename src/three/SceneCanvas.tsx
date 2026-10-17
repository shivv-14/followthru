import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

function AccentMesh() {
  const ref = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.x += delta * 0.15
    ref.current.rotation.y += delta * 0.22
  })

  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.4, 0]} />
      <meshStandardMaterial color="#7C5CFF" wireframe />
    </mesh>
  )
}

export interface SceneCanvasProps {
  maxDpr?: number
}

/** Default placeholder scene for the Stage wrapper. Kept deliberately light;
 * the real landing story scene replaces this in a later phase. */
export default function SceneCanvas({ maxDpr = 1.5 }: SceneCanvasProps) {
  return (
    <Canvas
      dpr={[1, maxDpr]}
      camera={{ position: [0, 0, 4], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 3, 3]} intensity={40} color="#7C5CFF" />
      <AccentMesh />
    </Canvas>
  )
}
