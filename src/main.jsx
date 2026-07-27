import {
  StrictMode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Stats } from "@react-three/drei";
import * as THREE from "three";
import InkDroplets from "./InkDroplets.jsx";
import InkWeapon from "./InkWeapon.jsx";
import Skybox from "./Skybox.jsx";
import PaintableSurface from "./paint/PaintableSurface.jsx";
import { createAtlasBoxGeometry } from "./paint/geometry.js";
import {
  projectileFragmentShader,
  projectileVertexShader,
} from "./paint/shaders.js";
import {
  ARENA,
  DEFAULT_WEAPON,
  INK,
  PAINT,
  PLAYER,
  PROJECTILE_CAPACITY,
  RUN,
} from "./settings.js";
import "./styles.css";

function FirstPersonMovement() {
  const keys = useRef(new Set());
  const { camera } = useThree();
  const vectors = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      movement: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    const down = (event) => keys.current.add(event.code);
    const up = (event) => keys.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, delta) => {
    const input = keys.current;
    const { forward, right, movement } = vectors;
    movement.set(0, 0, 0);
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();
    if (input.has("KeyW")) movement.add(forward);
    if (input.has("KeyS")) movement.sub(forward);
    if (input.has("KeyD")) movement.add(right);
    if (input.has("KeyA")) movement.sub(right);
    if (movement.lengthSq() > 0) {
      // Clamped so a frame hitch or a backgrounded tab cannot teleport the
      // player the length of the arena in a single step.
      movement
        .normalize()
        .multiplyScalar(PLAYER.moveSpeed * Math.min(delta, 1 / 30));
      camera.position.add(movement);
      camera.position.x = THREE.MathUtils.clamp(
        camera.position.x,
        -PLAYER.arenaLimit,
        PLAYER.arenaLimit,
      );
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z,
        -PLAYER.arenaLimit,
        PLAYER.arenaLimit,
      );
      camera.position.y = PLAYER.eyeHeight;
    }
  });

  return <PointerLockControls />;
}

const InkProjectiles = forwardRef(function InkProjectiles(_, ref) {
  const { geometry, material, positions, velocities, radii } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const nextGeometry = new THREE.InstancedBufferGeometry();
    nextGeometry.setIndex(quad.getIndex().clone());
    nextGeometry.setAttribute(
      "position",
      quad.getAttribute("position").clone(),
    );
    nextGeometry.setAttribute("uv", quad.getAttribute("uv").clone());
    nextGeometry.instanceCount = 0;
    const nextPositions = new Float32Array(PROJECTILE_CAPACITY * 3);
    const nextVelocities = new Float32Array(PROJECTILE_CAPACITY * 3);
    const nextRadii = new Float32Array(PROJECTILE_CAPACITY);
    for (const [name, data, size] of [
      ["aPosition", nextPositions, 3],
      ["aVelocity", nextVelocities, 3],
      ["aRadius", nextRadii, 1],
    ]) {
      const attribute = new THREE.InstancedBufferAttribute(data, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      nextGeometry.setAttribute(name, attribute);
    }
    const nextMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uInkColor: { value: new THREE.Color(PAINT.color) },
        uLightDirection: { value: new THREE.Vector3(...ARENA.lightDirection) },
      },
      vertexShader: projectileVertexShader,
      fragmentShader: projectileFragmentShader,
    });
    quad.dispose();
    return {
      geometry: nextGeometry,
      material: nextMaterial,
      positions: nextPositions,
      velocities: nextVelocities,
      radii: nextRadii,
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useImperativeHandle(
    ref,
    () => ({
      // Called by the weapon once per frame with its live projectiles. Dead shots
      // are simply left out of the compacted buffer, so a ball vanishes the frame
      // its splat appears.
      sync(projectiles) {
        let count = 0;
        for (const shot of projectiles) {
          if (!shot.alive) continue;
          const offset = count * 3;
          positions[offset] = shot.position.x;
          positions[offset + 1] = shot.position.y;
          positions[offset + 2] = shot.position.z;
          velocities[offset] = shot.velocity.x;
          velocities[offset + 1] = shot.velocity.y;
          velocities[offset + 2] = shot.velocity.z;
          radii[count] = shot.visualRadius;
          count += 1;
        }
        geometry.instanceCount = count;
        geometry.getAttribute("aPosition").needsUpdate = true;
        geometry.getAttribute("aVelocity").needsUpdate = true;
        geometry.getAttribute("aRadius").needsUpdate = true;
      },
    }),
    [geometry, positions, radii, velocities],
  );

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
});

function Arena({ onCoverage, onSpray, registerSurface }) {
  const floorGeometry = useMemo(
    () => new THREE.PlaneGeometry(ARENA.floorSize, ARENA.floorSize),
    [],
  );
  const blockGeometries = useMemo(
    () =>
      ARENA.blocks.map(([, , , width, height, depth]) =>
        createAtlasBoxGeometry(width, height, depth),
      ),
    [],
  );

  useEffect(
    () => () => {
      floorGeometry.dispose();
      for (const geometry of blockGeometries) geometry.dispose();
    },
    [blockGeometries, floorGeometry],
  );

  return (
    <>
      <Stats showPanel={0} className="stats" />
      <Skybox level={ARENA} />
      <ambientLight intensity={ARENA.ambientIntensity} />
      <directionalLight
        position={ARENA.lightDirection}
        intensity={ARENA.sunIntensity}
      />
      <PaintableSurface
        id="floor"
        geometry={floorGeometry}
        gridX={1}
        gridY={1}
        worldSpan={ARENA.floorSize}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        baseColor={ARENA.floorColor}
        inkColor={PAINT.color}
        lightDirection={ARENA.lightDirection}
        weight={ARENA.floorSize * ARENA.floorSize}
        onCoverage={onCoverage}
        onSpray={onSpray}
        registerSurface={registerSurface}
      />
      {ARENA.blocks.map(([x, y, z, width, height, depth], index) => (
        <PaintableSurface
          key={index}
          id={`block-${index}`}
          geometry={blockGeometries[index]}
          gridX={3}
          gridY={2}
          worldSpan={3 * Math.max(width, height, depth)}
          position={[x, y, z]}
          baseColor={ARENA.blockColors[index % ARENA.blockColors.length]}
          inkColor={PAINT.color}
          lightDirection={ARENA.lightDirection}
          weight={2 * (width * height + width * depth + height * depth)}
          onCoverage={onCoverage}
          onSpray={onSpray}
          registerSurface={registerSurface}
        />
      ))}
      <mesh position={[0, 0.12, -15]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[3.5, 40]} />
        <meshStandardMaterial
          color="#e9bc4a"
          emissive="#9d711b"
          emissiveIntensity={0.3}
        />
      </mesh>
    </>
  );
}

function World({
  runId,
  paintEnabled,
  ink,
  onCoverage,
  surfaces,
  onInkUse,
  registerSurface,
}) {
  const projectiles = useRef();
  const droplets = useRef();
  const sync = useCallback((shots) => projectiles.current?.sync(shots), []);
  const spray = useCallback(
    (position, radius, delay, velocity) =>
      droplets.current?.spawn(position, radius, delay, velocity),
    [],
  );

  // A splat is a sphere in the world, so it is offered to every surface rather
  // than only the one that was hit. That is what carries ink around a corner
  // and onto whatever else is standing within reach of the impact.
  const paint = useCallback(
    (center, radius, axis, stretch) => {
      for (const surface of surfaces.current.values())
        surface.splat(center, radius, axis, stretch);
    },
    [surfaces],
  );
  return (
    <Canvas camera={{ position: PLAYER.spawn, fov: PLAYER.fieldOfView }}>
      {!ARENA.skybox && (
        <color attach="background" args={[ARENA.backgroundColor]} />
      )}
      <fog attach="fog" args={[ARENA.fogColor, ARENA.fogNear, ARENA.fogFar]} />
      <FirstPersonMovement />
      <InkProjectiles ref={projectiles} />
      <InkDroplets ref={droplets} surfaces={surfaces} paint={paint} />
      <InkWeapon
        weapon={DEFAULT_WEAPON}
        paintEnabled={paintEnabled}
        ink={ink}
        surfaces={surfaces}
        paint={paint}
        onInkUse={onInkUse}
        onSync={sync}
      />
      <Arena
        key={runId}
        onCoverage={onCoverage}
        onSpray={spray}
        registerSurface={registerSurface}
      />
    </Canvas>
  );
}

function App() {
  const [remaining, setRemaining] = useState(RUN.seconds);
  const [ink, setInk] = useState(INK.capacity);
  const [running, setRunning] = useState(false);
  const [painted, setPainted] = useState(0);
  const [runId, setRunId] = useState(0);
  const coverageBySurface = useRef({});
  const surfaces = useRef(new Map());
  const deadline = useRef(0);

  // Counts down against a wall-clock deadline so a throttled tab cannot stretch
  // a three-minute run, and so the interval is not rebuilt on every tick.
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((deadline.current - performance.now()) / 1000),
      );
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        document.exitPointerLock?.();
      }
    };
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) return undefined;
    const recharge = window.setInterval(
      () =>
        setInk((value) =>
          Math.min(INK.capacity, value + INK.rechargePerSecond * 0.1),
        ),
      100,
    );
    return () => window.clearInterval(recharge);
  }, [running]);

  const startRun = () => {
    deadline.current = performance.now() + RUN.seconds * 1000;
    setRemaining(RUN.seconds);
    setInk(INK.capacity);
    setPainted(0);
    coverageBySurface.current = {};
    surfaces.current.clear();
    setRunId((value) => value + 1);
    setRunning(true);
  };

  const consumeInk = useCallback(
    (amount = 1.5) => setInk((value) => Math.max(0, value - amount)),
    [],
  );

  const registerSurface = useCallback((id, surface) => {
    surfaces.current.set(id, surface);
    return () => surfaces.current.delete(id);
  }, []);

  const reportCoverage = useCallback((id, coverage, weight) => {
    coverageBySurface.current[id] = { coverage, weight };
    const measured = Object.values(coverageBySurface.current);
    const totalWeight = measured.reduce(
      (total, surface) => total + surface.weight,
      0,
    );
    const coveredWeight = measured.reduce(
      (total, surface) => total + surface.coverage * surface.weight,
      0,
    );
    setPainted(totalWeight === 0 ? 0 : (coveredWeight / totalWeight) * 100);
  }, []);

  const paintEnabled = running && remaining > 0 && ink > 0;
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");

  return (
    <main>
      <World
        runId={runId}
        paintEnabled={paintEnabled}
        ink={ink}
        onCoverage={reportCoverage}
        surfaces={surfaces}
        onInkUse={consumeInk}
        registerSurface={registerSurface}
      />
      <div className="hud">
        <div className="brand">
          INK RUSH <span>prototype</span>
        </div>
        <div className="timer">
          {minutes}:{seconds}
        </div>
        <div className="score" aria-live="off">
          <span>Painted</span>
          <strong>{painted.toFixed(1)}%</strong>
        </div>
        <div className="ink">
          <span>INK</span>
          <div>
            <i style={{ width: `${(ink / INK.capacity) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="crosshair" aria-hidden="true">
        +
      </div>
      {!running && (
        <section className="start-card">
          {remaining === 0 ? (
            <p>
              Run complete — you covered <strong>{painted.toFixed(1)}%</strong>.
            </p>
          ) : (
            <p>A first-person paint time attack.</p>
          )}
          <button onClick={startRun}>
            {remaining === 0 ? "Run it again" : "Start 3-minute run"}
          </button>
          <small>
            Click the arena to look around · WASD to move · Hold left click to
            spray · Hold right click for a burst
          </small>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
