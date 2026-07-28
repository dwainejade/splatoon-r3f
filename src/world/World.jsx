import { useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import { ARENA, PLAYER } from "../settings.js";
import Arena from "./Arena.jsx";
import InkDroplets from "./InkDroplets.jsx";
import InkProjectiles from "./InkProjectiles.jsx";
import InkWeapon from "./InkWeapon.jsx";
import Player from "./Player.jsx";

// The 3D half of the game. Holds no game state of its own — it wires the
// simulation components to each other and to the callbacks App passes down.
export default function World({
  runId,
  weapon,
  paintEnabled,
  ink,
  surfaces,
  paint,
  onInkUse,
  onCoverage,
  registerSurface,
}) {
  const projectiles = useRef();
  const droplets = useRef();

  const sync = useCallback((shots) => projectiles.current?.sync(shots), []);
  const spray = useCallback(
    (position, radius, delay, velocity, color) =>
      droplets.current?.spawn(position, radius, delay, velocity, color),
    [],
  );

  return (
    <Canvas camera={{ position: PLAYER.spawn, fov: PLAYER.fieldOfView }}>
      <Stats showPanel={0} className="stats" />

      {/* A level with an HDR paints its own background. */}
      {!ARENA.skybox && (
        <color attach="background" args={[ARENA.backgroundColor]} />
      )}
      <fog attach="fog" args={[ARENA.fogColor, ARENA.fogNear, ARENA.fogFar]} />

      <Player />
      <InkProjectiles ref={projectiles} />
      <InkDroplets ref={droplets} surfaces={surfaces} paint={paint} />
      <InkWeapon
        weapon={weapon}
        paintEnabled={paintEnabled}
        ink={ink}
        surfaces={surfaces}
        paint={paint}
        onInkUse={onInkUse}
        onSync={sync}
      />

      {/* Keyed on the run so a restart rebuilds every paint mask from scratch. */}
      <Arena
        key={runId}
        onCoverage={onCoverage}
        onSpray={spray}
        registerSurface={registerSurface}
      />
    </Canvas>
  );
}
