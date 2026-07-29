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
  const verticalSpeed = useRef(0);
  const vectors = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      movement: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    const down = (event) => {
      keys.current.add(event.code);
      // Only takes effect while grounded — held Space does not chain into a
      // second jump the instant the player lands.
      if (event.code === "Space" && camera.position.y <= PLAYER.eyeHeight) {
        verticalSpeed.current = PLAYER.jumpSpeed;
      }
    };
    const up = (event) => keys.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera]);

  useFrame((_, rawDelta) => {
    // Clamped so a frame hitch or a backgrounded tab cannot teleport the player
    // the length of the arena — or send it flying — in a single step.
    const delta = Math.min(rawDelta, 1 / 30);
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
      movement.normalize().multiplyScalar(PLAYER.moveSpeed * delta);
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
    }

    // Free-fall integration, then clamp back to the floor rather than letting
    // the camera settle exactly on PLAYER.eyeHeight — this is what turns a
    // jump from an instant snap-back into an actual arc.
    verticalSpeed.current -= PLAYER.gravity * delta;
    camera.position.y += verticalSpeed.current * delta;
    if (camera.position.y <= PLAYER.eyeHeight) {
      camera.position.y = PLAYER.eyeHeight;
      verticalSpeed.current = 0;
    }
  });

  return <PointerLockControls />;
}
