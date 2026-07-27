import { useCallback, useEffect, useRef, useState } from 'react'
import { RUN } from '../settings.js'

// The match clock.
//
// Counts down against a wall-clock deadline rather than by accumulating ticks,
// so a throttled or backgrounded tab cannot stretch a three-minute run — and
// the interval is not torn down and rebuilt on every tick.
export default function useRun() {
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(RUN.seconds)
  const [runId, setRunId] = useState(0)
  const deadline = useRef(0)

  useEffect(() => {
    if (!running) return undefined

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000))
      setRemaining(left)
      if (left === 0) {
        setRunning(false)
        document.exitPointerLock?.()
      }
    }

    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [running])

  // Bumping runId is what remounts the arena, which is how masks get cleared.
  const start = useCallback(() => {
    deadline.current = performance.now() + RUN.seconds * 1000
    setRemaining(RUN.seconds)
    setRunId((value) => value + 1)
    setRunning(true)
  }, [])

  return { running, remaining, runId, start }
}
