import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PROJECTILE_CAPACITY, WEAPONS } from "../settings.js";

// Cosmetic-only ink balls fired by other players. Each "fire" event carries a
// weapon key and a starting position/aim, and this simulates the whole
// pattern locally with the same ballistics table InkWeapon uses — so the
// flight looks the same to every client — but never calls paint() itself.
// The actual splat still arrives through its own broadcast once the real
// shooter's raycast lands, so a visual desync here can never cost paint; the
// raycast below only decides when to stop drawing the ball, so it does not
// keep flying visibly through a wall it should have splatted against.
export default function RemoteProjectiles({ network, renderer, surfaces }) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const meshes = useMemo(() => [], []);
  const scratch = useMemo(
    () => ({
      aim: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      jitter: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      segment: new THREE.Vector3(),
    }),
    [],
  );

  const projectiles = useMemo(
    () =>
      Array.from({ length: PROJECTILE_CAPACITY }, () => ({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        radius: 0,
        fullVisualRadius: 0,
        visualRadius: 0,
        distance: 0,
        age: 0,
        lifetime: 0,
        gravity: 0,
        emergenceDistance: 1,
        color: new THREE.Color(),
      })),
    [],
  );

  useEffect(
    () =>
      network.onRemoteFire((fire) => {
        const weapon = WEAPONS[fire.weaponKey];
        if (!weapon) return;

        scratch.aim.set(fire.dx, fire.dy, fire.dz);
        const spread = fire.charge > 0 ? weapon.chargeSpread : weapon.spread;
        const pellets = weapon.pellets ?? 1;

        for (let pellet = 0; pellet < pellets; pellet += 1) {
          const shot = projectiles.find((candidate) => !candidate.alive);
          if (!shot) break;

          scratch.direction.copy(scratch.aim);
          scratch.jitter.set(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5,
          );
          scratch.direction.addScaledVector(scratch.jitter, spread).normalize();

          shot.alive = true;
          shot.position
            .set(fire.ox, fire.oy, fire.oz)
            .addScaledVector(scratch.direction, 0.55);
          shot.position.y -= 0.17;
          shot.velocity
            .copy(scratch.direction)
            .multiplyScalar(
              weapon.muzzleSpeed * (1 + fire.charge * weapon.chargeSpeedScale),
            );
          shot.radius = weapon.radius * (1 + fire.charge * weapon.chargeRadiusScale);
          shot.fullVisualRadius = shot.radius * weapon.projectileRadiusScale;
          shot.visualRadius = 0;
          shot.distance = 0;
          shot.age = 0;
          shot.lifetime = weapon.lifetime;
          shot.gravity = weapon.gravity;
          shot.emergenceDistance = weapon.emergenceDistance;
          shot.color.set(fire.color);
        }
      }),
    [network, projectiles, scratch],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);

    meshes.length = 0;
    for (const surface of surfaces.current.values()) meshes.push(surface.mesh);

    for (const shot of projectiles) {
      if (!shot.alive) continue;

      scratch.previous.copy(shot.position);
      shot.velocity.y -= shot.gravity * delta;
      shot.position.addScaledVector(shot.velocity, delta);
      shot.age += delta;

      scratch.segment.subVectors(shot.position, scratch.previous);
      const travelled = scratch.segment.length();
      shot.distance += travelled;

      shot.visualRadius =
        shot.fullVisualRadius *
        Math.min(1, shot.distance / shot.emergenceDistance);

      // Only decides when to stop drawing the ball — never paints. The
      // shooter's own client is the one deciding, and broadcasting, where it
      // actually lands.
      if (travelled > 1e-6 && meshes.length > 0) {
        scratch.segment.divideScalar(travelled);
        raycaster.set(scratch.previous, scratch.segment);
        raycaster.near = 0;
        raycaster.far = travelled;
        if (raycaster.intersectObjects(meshes, false).length > 0) {
          shot.alive = false;
          continue;
        }
      }

      if (shot.age >= shot.lifetime || shot.position.y < -4) shot.alive = false;
    }

    renderer.current?.sync(projectiles);
  });

  return null;
}
