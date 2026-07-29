import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'

// Every paintable surface in the level, keyed by id.
//
// A ref rather than state on purpose: surfaces register during mount and are
// read every frame by the weapon's raycast, so this must never trigger a
// re-render.
export default function useSurfaceRegistry() {
  const surfaces = useRef(new Map())
  const scratchCenter = useMemo(() => new THREE.Vector3(), [])
  const scratchAxis = useMemo(() => new THREE.Vector3(), [])

  const register = useCallback((id, surface) => {
    surfaces.current.set(id, surface)
    return () => surfaces.current.delete(id)
  }, [])

  const clear = useCallback(() => surfaces.current.clear(), [])

  // A splat is a sphere in the world, so it is offered to every surface rather
  // than only the one that was hit. That is what carries ink around a corner
  // and onto whatever else is standing within reach of the impact.
  const paint = useCallback((center, radius, axis, stretch, color) => {
    for (const surface of surfaces.current.values()) {
      surface.splat(center, radius, axis, stretch, color)
    }
  }, [])

  // Same as paint, but for a splat that arrived over the network as plain
  // numbers rather than THREE.Vector3 instances. Reuses one scratch pair
  // rather than allocating per remote splat, since these arrive on their own
  // schedule and can spike when a room gets busy.
  const paintVector = useCallback(
    (splat) => {
      scratchCenter.set(splat.cx, splat.cy, splat.cz)
      scratchAxis.set(splat.ax, splat.ay, splat.az)
      paint(scratchCenter, splat.radius, scratchAxis, splat.stretch, splat.color)
    },
    [paint, scratchAxis, scratchCenter],
  )

  return { surfaces, register, clear, paint, paintVector }
}
