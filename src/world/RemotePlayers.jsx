import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { NETWORK } from "../settings.js";

const MAX_REMOTE_PLAYERS = 16;

// Render this far behind the newest packet, in milliseconds. Packets arrive
// roughly every NETWORK.stateSendInterval; rendering a beat behind the newest
// one means there is (almost) always a real "next" sample to interpolate
// toward instead of guessing at motion that hasn't been reported yet.
const INTERP_DELAY_MS = 100;

// The multiplayer half of the scene: sends this client's own transform to the
// room at a fixed interval, and draws every other player as a simple coloured
// capsule. Both live in one component because they share a cadence — there is
// no reason to broadcast local state and read remote state on two different
// schedules.
//
// Remote transforms are read straight from the network hook's ref map every
// frame rather than mirrored into React state — with a room ticking updates
// ten times a second per player, going through props would mean a re-render
// storm for what is ultimately just "move this mesh."
export default function RemotePlayers({ network }) {
  const group = useRef();
  // One outer group per slot carries position/rotation; body and weapon are
  // children of it so both inherit the same interpolated transform and the
  // weapon always points the way its player is actually looking.
  const rigs = useRef([]);
  const bodyMaterials = useRef([]);
  const sendElapsed = useRef(0);
  const sendRotation = useRef(new THREE.Quaternion());
  const previousRotation = useRef(new THREE.Quaternion());
  const targetRotation = useRef(new THREE.Quaternion());

  useFrame((state, delta) => {
    sendElapsed.current += delta;
    if (sendElapsed.current >= NETWORK.stateSendInterval) {
      sendElapsed.current = 0;
      const { camera } = state;
      sendRotation.current.copy(camera.quaternion);
      network.sendState(
        [camera.position.x, camera.position.y, camera.position.z],
        [
          sendRotation.current.x,
          sendRotation.current.y,
          sendRotation.current.z,
          sendRotation.current.w,
        ],
      );
    }

    if (!group.current) return;
    // Rendering slightly in the past means there is almost always a real
    // "next" sample on hand — extrapolating past the newest packet instead
    // would guess at motion that may have already stopped or turned.
    const renderTime = performance.now() - INTERP_DELAY_MS;

    let index = 0;
    for (const player of network.remotePlayers.current.values()) {
      if (index >= MAX_REMOTE_PLAYERS) break;
      const rig = rigs.current[index];
      const bodyMaterial = bodyMaterials.current[index];
      index += 1;
      if (!rig) continue;

      const { previous, target } = player;
      rig.visible = true;

      const span = target.time - previous.time;
      // span can be 0 for a player's very first packet (previous === target)
      // or if two updates land in the same tick; clamping to the target
      // avoids a divide-by-zero turning into NaN and vanishing the avatar.
      const t = span > 0
        ? THREE.MathUtils.clamp((renderTime - previous.time) / span, 0, 1)
        : 1;

      rig.position.set(
        THREE.MathUtils.lerp(previous.position[0], target.position[0], t),
        THREE.MathUtils.lerp(previous.position[1], target.position[1], t),
        THREE.MathUtils.lerp(previous.position[2], target.position[2], t),
      );
      // Eye-height position minus the capsule's own half-height, so the
      // avatar's feet land near the floor instead of the camera's eye.
      rig.position.y -= 0.9;

      previousRotation.current.set(...previous.rotation);
      targetRotation.current.set(...target.rotation);
      // Full look rotation (pitch and yaw), not just yaw — the weapon child
      // below inherits this directly, so aiming up or down actually tilts it.
      rig.quaternion.copy(previousRotation.current).slerp(targetRotation.current, t);

      if (bodyMaterial) bodyMaterial.color.set(player.color);
    }
    for (; index < MAX_REMOTE_PLAYERS; index += 1) {
      const rig = rigs.current[index];
      if (rig) rig.visible = false;
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: MAX_REMOTE_PLAYERS }, (_, index) => (
        <group key={index} visible={false} ref={(rig) => (rigs.current[index] = rig)}>
          <mesh>
            <capsuleGeometry args={[0.35, 1.1, 4, 8]} />
            <meshStandardMaterial ref={(material) => (bodyMaterials.current[index] = material)} color="#ffffff" />
          </mesh>
          {/* A plain barrel pointing the way this rig's rotation faces — the
              same quaternion the camera reports, pitch included, so it tilts
              up or down with the player's aim rather than staying level.
              Camera-forward is -Z, so the cylinder (built along local +Y) is
              tipped with a negative X rotation and pushed forward by half its
              own length so it reads as extending out from the shoulder
              rather than being centred through it. Sized to read clearly at
              normal arena viewing distance rather than disappearing against
              the body — a thin true-to-life barrel was invisible past a few
              metres. */}
          <mesh position={[0.25, 0.2, -0.85]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.11, 0.9, 8]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
