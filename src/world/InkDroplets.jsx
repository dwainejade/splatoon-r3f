import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  projectileFragmentShader,
  projectileVertexShader,
} from "../paint/shaders.js";
import { ARENA, DROPLET_CAPACITY, PAINT } from "../settings.js";

// Airborne ink. Two things feed this pool and both behave the same once in the
// air: drips that run off the bottom lip of a face, and splashes thrown up when
// a shot lands. Each droplet falls under gravity, sweeps against the world, and
// paints where it lands — which is also what carries paint from one surface to
// another without the two masks knowing anything about each other.
const InkDroplets = forwardRef(function InkDroplets({ surfaces, paint }, ref) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const meshes = useMemo(() => [], []);
  const scratch = useMemo(
    () => ({
      previous: new THREE.Vector3(),
      segment: new THREE.Vector3(),
    }),
    [],
  );

  const drops = useMemo(
    () =>
      Array.from({ length: DROPLET_CAPACITY }, () => ({
        alive: false,
        falling: false,
        delay: 0,
        age: 0,
        radius: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      })),
    [],
  );

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
    const nextPositions = new Float32Array(DROPLET_CAPACITY * 3);
    const nextVelocities = new Float32Array(DROPLET_CAPACITY * 3);
    const nextRadii = new Float32Array(DROPLET_CAPACITY);
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
      // delay is how long a run still needs to creep down a face before it
      // reaches the lip and lets go; splashes pass 0 and launch immediately.
      spawn(position, radius, delay, velocity) {
        const drop = drops.find((candidate) => !candidate.alive);
        if (!drop) return;
        drop.alive = true;
        drop.falling = delay <= 0;
        drop.delay = delay;
        drop.age = 0;
        drop.radius = radius;
        drop.position.copy(position);
        drop.velocity.copy(velocity);
      },
    }),
    [drops],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);

    meshes.length = 0;
    for (const surface of surfaces.current.values()) meshes.push(surface.mesh);

    let count = 0;
    for (const drop of drops) {
      if (!drop.alive) continue;

      // Still creeping down the face; not yet a falling drop.
      if (!drop.falling) {
        drop.delay -= delta;
        if (drop.delay > 0) continue;
        drop.falling = true;
      }

      scratch.previous.copy(drop.position);
      drop.velocity.y -= PAINT.shedGravity * delta;
      drop.position.addScaledVector(drop.velocity, delta);
      drop.age += delta;

      scratch.segment.subVectors(drop.position, scratch.previous);
      const travelled = scratch.segment.length();

      if (travelled > 1e-6 && meshes.length > 0) {
        scratch.segment.divideScalar(travelled);
        raycaster.set(scratch.previous, scratch.segment);
        raycaster.near = 0;
        raycaster.far = travelled;
        const hit = raycaster.intersectObjects(meshes, false)[0];
        if (hit) {
          // Stretch of 1: a drop lands under its own weight, so it pools rather
          // than smearing the way a fired shot does.
          paint(hit.point, drop.radius, scratch.segment, 1);
          drop.alive = false;
          continue;
        }
      }

      if (drop.age >= PAINT.shedLifetime || drop.position.y < -4) {
        drop.alive = false;
        continue;
      }

      const offset = count * 3;
      positions[offset] = drop.position.x;
      positions[offset + 1] = drop.position.y;
      positions[offset + 2] = drop.position.z;
      velocities[offset] = drop.velocity.x;
      velocities[offset + 1] = drop.velocity.y;
      velocities[offset + 2] = drop.velocity.z;
      radii[count] = drop.radius * 0.5;
      count += 1;
    }

    geometry.instanceCount = count;
    geometry.getAttribute("aPosition").needsUpdate = true;
    geometry.getAttribute("aVelocity").needsUpdate = true;
    geometry.getAttribute("aRadius").needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
});

export default InkDroplets;
