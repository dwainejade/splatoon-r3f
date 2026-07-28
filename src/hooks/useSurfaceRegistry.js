import { useCallback, useRef } from 'react'

// Every paintable surface in the level, keyed by id.
//
// A ref rather than state on purpose: surfaces register during mount and are
// read every frame by the weapon's raycast, so this must never trigger a
// re-render.
export default function useSurfaceRegistry() {
  const surfaces = useRef(new Map())

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

  return { surfaces, register, clear, paint }
}
