import { useCallback } from 'react'
import useCoverage from './hooks/useCoverage.js'
import useInkTank from './hooks/useInkTank.js'
import useRun from './hooks/useRun.js'
import useSurfaceRegistry from './hooks/useSurfaceRegistry.js'
import Hud from './ui/Hud.jsx'
import StartCard from './ui/StartCard.jsx'
import World from './world/World.jsx'

// Orchestration only. The four concerns a run is made of each live in their own
// hook, and this decides how they fit together.
export default function App() {
  const run = useRun()
  const tank = useInkTank(run.running)
  const coverage = useCoverage()
  const registry = useSurfaceRegistry()

  // Order matters: everything is cleared before the arena remounts and its
  // surfaces register themselves again.
  const startRun = useCallback(() => {
    tank.refill()
    coverage.reset()
    registry.clear()
    run.start()
  }, [coverage, registry, run, tank])

  const paintEnabled = run.running && run.remaining > 0 && tank.ink > 0

  return (
    <main>
      <World
        runId={run.runId}
        paintEnabled={paintEnabled}
        ink={tank.ink}
        surfaces={registry.surfaces}
        paint={registry.paint}
        onInkUse={tank.consume}
        onCoverage={coverage.report}
        registerSurface={registry.register}
      />

      <Hud remaining={run.remaining} painted={coverage.painted} ink={tank.ink} />

      {!run.running && (
        <StartCard
          finished={run.remaining === 0}
          painted={coverage.painted}
          onStart={startRun}
        />
      )}
    </main>
  )
}
