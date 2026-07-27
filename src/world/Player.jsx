import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import { PLAYER } from "../settings.js";

// First-person movement. Owns nothing but the camera, so it can sit anywhere in
// the scene graph.
export default function Player() {
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
    if (movement.lengthSq() === 0) return;

    // Clamped so a frame hitch or a backgrounded tab cannot teleport the player
    // the length of the arena in a single step.
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
  });

  return <PointerLockControls />;
}
