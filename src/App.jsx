import { useCallback, useEffect, useState } from "react";
import useCoverage from "./hooks/useCoverage.js";
import useInkTank from "./hooks/useInkTank.js";
import useNetwork from "./hooks/useNetwork.js";
import useSurfaceRegistry from "./hooks/useSurfaceRegistry.js";
import useWeapon from "./hooks/useWeapon.js";
import { WEAPON_ORDER } from "./settings.js";
import Hud from "./ui/Hud.jsx";
import StartCard from "./ui/StartCard.jsx";
import World from "./world/World.jsx";

// Orchestration only. Multiplayer free-roam: no timer, no coverage-based win
// condition — StartCard's only job now is the click that a browser requires
// before it will grant pointer lock. Once clicked, painting stays enabled for
// the rest of the session.
export default function App() {
  const [joined, setJoined] = useState(false);
  const tank = useInkTank(joined);
  const coverage = useCoverage();
  const registry = useSurfaceRegistry();
  const { weapon, slot } = useWeapon();
  const network = useNetwork();
  // Ref-backed remotePlayers stays out of React state for the hot path (see
  // useNetwork), so the HUD's count is tracked separately via join/leave.
  const [remoteCount, setRemoteCount] = useState(0);

  const join = useCallback(() => setJoined(true), []);

  const paintEnabled = joined && tank.ink > 0;

  // Every local splat both lands on this client's own masks and goes out to
  // the room. Remote splats call registry.paint directly (see World's
  // useEffect below) so they are never re-broadcast into an echo.
  const paint = useCallback(
    (center, radius, axis, stretch, color) => {
      registry.paint(center, radius, axis, stretch, color);
      network.sendSplat({
        cx: center.x,
        cy: center.y,
        cz: center.z,
        ax: axis.x,
        ay: axis.y,
        az: axis.z,
        radius,
        stretch,
      });
    },
    [network, registry],
  );

  // Applies splats reported by other players straight onto this client's own
  // surfaces — the same call the local weapon makes, minus the broadcast.
  useEffect(
    () =>
      network.onRemoteSplat((splat) => {
        registry.paintVector(splat);
      }),
    [network, registry],
  );

  useEffect(() => {
    setRemoteCount(network.remotePlayers.current.size);
    const offJoin = network.onPlayerJoin(() =>
      setRemoteCount(network.remotePlayers.current.size),
    );
    const offLeave = network.onPlayerLeave(() =>
      setRemoteCount(network.remotePlayers.current.size),
    );
    return () => {
      offJoin();
      offLeave();
    };
  }, [network]);

  return (
    <main>
      <World
        weapon={weapon}
        weaponKey={WEAPON_ORDER[slot]}
        paintEnabled={paintEnabled}
        ink={tank.ink}
        surfaces={registry.surfaces}
        paint={paint}
        onInkUse={tank.consume}
        onCoverage={coverage.report}
        registerSurface={registry.register}
        network={network}
        localColor={network.localColor}
      />

      <Hud
        painted={coverage.painted}
        ink={tank.ink}
        weapon={weapon}
        slot={slot}
        playerCount={remoteCount + 1}
      />

      {!joined && <StartCard onStart={join} />}
    </main>
  );
}
