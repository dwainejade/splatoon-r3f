import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import * as THREE from "three";
import {
  projectileFragmentShader,
  projectileVertexShader,
} from "../paint/shaders.js";
import { ARENA, PROJECTILE_CAPACITY } from "../settings.js";

// The balls of ink in flight, one instanced billboard each. Purely a renderer:
// the weapon owns the simulation and hands it whatever is currently alive.
const InkProjectiles = forwardRef(function InkProjectiles(_, ref) {
  const { geometry, material, positions, velocities, radii, colors } = useMemo(() => {
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
    const nextColors = new Float32Array(PROJECTILE_CAPACITY * 3);
    for (const [name, data, size] of [
      ["aPosition", nextPositions, 3],
      ["aVelocity", nextVelocities, 3],
      ["aRadius", nextRadii, 1],
      ["aColor", nextColors, 3],
    ]) {
      const attribute = new THREE.InstancedBufferAttribute(data, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      nextGeometry.setAttribute(name, attribute);
    }

    const nextMaterial = new THREE.ShaderMaterial({
      uniforms: {
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
      colors: nextColors,
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
      // are simply left out of the compacted buffer, so a ball vanishes on the
      // frame its splat appears.
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
          colors[offset] = shot.color.r;
          colors[offset + 1] = shot.color.g;
          colors[offset + 2] = shot.color.b;
          radii[count] = shot.visualRadius;
          count += 1;
        }
        geometry.instanceCount = count;
        geometry.getAttribute("aPosition").needsUpdate = true;
        geometry.getAttribute("aVelocity").needsUpdate = true;
        geometry.getAttribute("aRadius").needsUpdate = true;
        geometry.getAttribute("aColor").needsUpdate = true;
      },
    }),
    [colors, geometry, positions, radii, velocities],
  );

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
});

export default InkProjectiles;
