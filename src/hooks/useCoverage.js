import { useCallback, useRef, useState } from 'react'

// The painted score.
//
// Each surface reports its own coverage independently and at its own cadence,
// so the running total is kept in a ref and only the derived percentage is
// state — surfaces report several times a second and none of them should force
// a re-render on their own.
export default function useCoverage() {
  const [painted, setPainted] = useState(0)
  const bySurface = useRef({})

  const report = useCallback((id, coverage, weight) => {
    bySurface.current[id] = { coverage, weight }

    const measured = Object.values(bySurface.current)
    const totalWeight = measured.reduce((total, surface) => total + surface.weight, 0)
    const coveredWeight = measured.reduce(
      (total, surface) => total + surface.coverage * surface.weight,
      0,
    )

    setPainted(totalWeight === 0 ? 0 : (coveredWeight / totalWeight) * 100)
  }, [])

  const reset = useCallback(() => {
    bySurface.current = {}
    setPainted(0)
  }, [])

  return { painted, report, reset }
}
