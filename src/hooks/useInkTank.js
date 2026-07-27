import { useCallback, useEffect, useState } from 'react'
import { INK } from '../settings.js'

// The ink tank: drains as the weapon fires, refills on its own, and only while
// a run is active so it does not tick away on the start screen.
export default function useInkTank(running) {
  const [ink, setInk] = useState(INK.capacity)

  useEffect(() => {
    if (!running) return undefined
    const recharge = window.setInterval(
      () => setInk((value) => Math.min(INK.capacity, value + INK.rechargePerSecond * 0.1)),
      100,
    )
    return () => window.clearInterval(recharge)
  }, [running])

  const consume = useCallback(
    (amount = 1.5) => setInk((value) => Math.max(0, value - amount)),
    [],
  )

  const refill = useCallback(() => setInk(INK.capacity), [])

  return { ink, consume, refill }
}
