import { useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import { ARENA, PLAYER } from "../settings.js";
import Arena from "./Arena.jsx";
import InkDroplets from "./InkDroplets.jsx";
import InkProjectiles from "./InkProjectiles.jsx";
import InkWeapon from "./InkWeapon.jsx";
import Player from "./Player.jsx";
import RemotePlayers from "./RemotePlayers.jsx";
import RemoteProjectiles from "./RemoteProjectiles.jsx";

// The 3D half of the game. Holds no game state of its own — it wires the
// simulation components to each other and to the callbacks App passes down.
export default function World({
  weapon,
  weaponKey,
  paintEnabled,
  ink,
  surfaces,
  paint,
  onInkUse,
  onCoverage,
  registerSurface,
  network,
  localColor,
}) {
  const projectiles = useRef();
  const remoteProjectiles = useRef();
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
      {network && <RemotePlayers network={network} />}
      <InkProjectiles ref={projectiles} />
      <InkDroplets ref={droplets} surfaces={surfaces} paint={paint} />
      <InkWeapon
        weapon={weapon}
        weaponKey={weaponKey}
        inkColor={localColor}
        paintEnabled={paintEnabled}
        ink={ink}
        surfaces={surfaces}
        paint={paint}
        onInkUse={onInkUse}
        onSync={sync}
        network={network}
      />

      {/* The visible ink balls other players are firing right now — cosmetic
          only, rendered through its own instanced pool so a busy room can't
          starve the local player's own shots of a slot in PROJECTILE_CAPACITY. */}
      {network && (
        <>
          <InkProjectiles ref={remoteProjectiles} />
          <RemoteProjectiles
            network={network}
            renderer={remoteProjectiles}
            surfaces={surfaces}
          />
        </>
      )}

      {/* Mounted once for the session: in a shared room, remounting would
          wipe every connected player's ink out from under them. */}
      <Arena
        onCoverage={onCoverage}
        onSpray={spray}
        registerSurface={registerSurface}
      />
    </Canvas>
  );
}
