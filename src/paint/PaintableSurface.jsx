import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { analyzeCells, cellPointToWorld, resolveCells } from "./geometry.js";
import {
  createColorTarget,
  createMaskTarget,
  createPositionTarget,
  getPasses,
  MAX_ATLAS_CELLS,
  pickMaskSize,
} from "./passes.js";
import { surfaceFragmentShader, surfaceVertexShader } from "./shaders.js";
import { PAINT, SCORING } from "../settings.js";
import { useSkyReflection } from "../world/SkyReflection.jsx";

const REDUCE_SIZE = 64;
const REDUCE_TAPS = 8;
// Two passes of one-texel bleed, which covers the atlas padding and any UV
// seam. Must be even so the ping-pong ends up back in the first target.
const DILATE_PASSES = 2;

export default function PaintableSurface({
  id,
  geometry,
  // Scalars rather than a [x, y] prop: a fresh array literal each render would
  // re-run the cell analysis every time the HUD updates.
  gridX,
  gridY,
  worldSpan,
  position,
  rotation,
  baseColor,
  inkColor,
  lightDirection,
  weight,
  onCoverage,
  onSpray,
  registerSurface,
}) {
  const { gl } = useThree();
  const { texture: skyReflection } = useSkyReflection();
  const mesh = useRef();
  const pending = useRef([]);
  const pendingSheds = useRef([]);
  const wetUntil = useRef(0);
  const lastScore = useRef(0);
  const scoreDirty = useRef(true);
  const cells = useRef(null);
  const bounds = useRef(new THREE.Sphere());

  const maskSize = useMemo(() => pickMaskSize(worldSpan), [worldSpan]);

  const targets = useMemo(
    () => ({
      read: createMaskTarget(maskSize),
      write: createMaskTarget(maskSize),
      colorRead: createColorTarget(maskSize),
      colorWrite: createColorTarget(maskSize),
      position: createPositionTarget(maskSize),
      reduce: new THREE.WebGLRenderTarget(REDUCE_SIZE, REDUCE_SIZE, {
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      }),
    }),
    [maskSize],
  );

  const scorePixels = useMemo(
    () => new Uint8Array(REDUCE_SIZE * REDUCE_SIZE * 4),
    [],
  );
  const travel = useMemo(() => new THREE.Vector3(), []);
  const lipPoint = useMemo(() => new THREE.Vector3(), []);
  const shedVelocity = useMemo(() => new THREE.Vector3(), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            paintMask: { value: null },
            colorMask: { value: null },
            uMaskSize: { value: new THREE.Vector2(maskSize, maskSize) },
            uGrid: { value: new THREE.Vector2(gridX, gridY) },
            baseColor: { value: new THREE.Color(baseColor) },
            uLightDirection: { value: new THREE.Vector3(...lightDirection) },
            uBulge: { value: PAINT.bulge },
            uSpecular: { value: PAINT.specular },
            // Filled in once the skybox has decoded; levels without an HDR
            // simply leave the strength at zero.
            uSkyMap: { value: null },
            uSkyStrength: { value: 0 },
          },
        ]),
        vertexShader: surfaceVertexShader,
        fragmentShader: surfaceFragmentShader,
        fog: true,
      }),
    [baseColor, gridX, gridY, lightDirection, maskSize],
  );

  useEffect(() => {
    material.uniforms.uSkyMap.value = skyReflection;
    material.uniforms.uSkyStrength.value = skyReflection ? PAINT.reflection : 0;
  }, [material, skyReflection]);

  // Both masks start empty; the flow pass ping-pongs between them from there.
  // The colour masks are cleared to this surface's default ink colour instead
  // of black — irrelevant until something is painted, but it keeps a stray
  // read from ever showing pure black paint.
  useEffect(() => {
    const previousTarget = gl.getRenderTarget();
    const previousColor = gl.getClearColor(new THREE.Color());
    const previousAlpha = gl.getClearAlpha();

    gl.setClearColor(0x000000, 1);
    for (const target of [targets.read, targets.write]) {
      gl.setRenderTarget(target);
      gl.clear(true, false, false);
    }

    gl.setClearColor(new THREE.Color(inkColor), 1);
    for (const target of [targets.colorRead, targets.colorWrite]) {
      gl.setRenderTarget(target);
      gl.clear(true, false, false);
    }

    gl.setRenderTarget(previousTarget);
    gl.setClearColor(previousColor, previousAlpha);
    material.uniforms.paintMask.value = targets.read.texture;
    material.uniforms.colorMask.value = targets.colorRead.texture;
  }, [gl, inkColor, material, targets]);

  useEffect(
    () => () => {
      targets.read.dispose();
      targets.write.dispose();
      targets.colorRead.dispose();
      targets.colorWrite.dispose();
      targets.position.dispose();
      targets.reduce.dispose();
      material.dispose();
    },
    [material, targets],
  );

  // A splat is a sphere in the world; this only has to decide whether any of
  // this surface is inside it. Nothing here knows about faces or UVs, which is
  // exactly why ink carries over an edge onto the next face.
  const splat = useCallback((center, radius, axis, stretch, color) => {
    const reach = radius * Math.max(1, stretch) * 1.25;
    if (
      center.distanceToSquared(bounds.current.center) >
      (bounds.current.radius + reach) ** 2
    ) {
      return false;
    }
    pending.current.push({
      cx: center.x,
      cy: center.y,
      cz: center.z,
      ax: axis.x,
      ay: axis.y,
      az: axis.z,
      radius,
      stretch,
      color: color ?? inkColor,
    });
    return true;
  }, [inkColor]);

  // Only the surface actually hit runs this; it needs a UV to know which face
  // the ink landed on and therefore which way a run would travel.
  const shedFrom = useCallback((uv, radius, direction, color) => {
    pendingSheds.current.push({
      u: uv.x,
      v: uv.y,
      radius,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
      color: color ?? inkColor,
    });
  }, [inkColor]);

  // A run that reaches the bottom lip of a face does not stop there — it falls
  // off. Rather than reading the mask back to find ink at an edge, work out at
  // stamp time whether this splat's run will reach the edge before it dries,
  // and if so hand the crossing point and its arrival time to the drip system.
  const shedFromCell = useCallback(
    (cell, shot) => {
      if (!onSpray || PAINT.shedChance <= 0) return;
      // Landed drops paint a small splat. Excluding them here is what stops a
      // drop shedding another drop forever.
      if (shot.radius <= PAINT.shedSplatRadius * 1.2) return;
      if (Math.random() > PAINT.shedChance) return;

      const speed = cell.flow.length();
      if (speed < 1e-5) return; // horizontal face: ink pools instead of running

      const directionU = cell.flow.x / speed;
      const directionV = cell.flow.y / speed;

      // Distance in UV from the splat centre to whichever edge of the face the
      // flow reaches first. Measured against the face's real extent, not the
      // padded cell, so the lip is the actual bottom of the geometry.
      let toEdge = Infinity;
      if (directionU > 1e-6)
        toEdge = Math.min(toEdge, (cell.faceMax.x - shot.u) / directionU);
      else if (directionU < -1e-6)
        toEdge = Math.min(toEdge, (cell.faceMin.x - shot.u) / directionU);
      if (directionV > 1e-6)
        toEdge = Math.min(toEdge, (cell.faceMax.y - shot.v) / directionV);
      else if (directionV < -1e-6)
        toEdge = Math.min(toEdge, (cell.faceMin.y - shot.v) / directionV);
      if (!Number.isFinite(toEdge) || toEdge < 0) return;

      // The splat already covers part of that distance, so only the rest has to
      // creep. A wide splat landing across the lip sheds immediately rather than
      // being rejected for having its leading edge past the edge already.
      const radiusUv =
        shot.radius *
        Math.hypot(
          directionU * cell.uvPerMeter.x,
          directionV * cell.uvPerMeter.y,
        );
      const toCreep = Math.max(0, toEdge - radiusUv);
      if (toCreep > speed * PAINT.wetSeconds) return;

      cellPointToWorld(
        cell,
        shot.u + directionU * toEdge,
        shot.v + directionV * toEdge,
        lipPoint,
      );
      // Clear of the face, so the drop does not immediately re-hit the wall it left.
      lipPoint.addScaledVector(cell.normal, 0.04);
      shedVelocity.set(0, -PAINT.shedFallSpeed, 0);
      onSpray(lipPoint, PAINT.shedSplatRadius, toCreep / speed, shedVelocity, shot.color);
    },
    [lipPoint, onSpray, shedVelocity],
  );

  useEffect(() => {
    mesh.current.updateWorldMatrix(true, false);
    cells.current = resolveCells(
      analyzeCells(geometry, gridX, gridY),
      mesh.current.matrixWorld,
      PAINT.dripSpeed,
    );

    geometry.computeBoundingSphere();
    bounds.current
      .copy(geometry.boundingSphere)
      .applyMatrix4(mesh.current.matrixWorld);

    // Bake where every texel of this mask lives in 3D, then bleed it outwards so
    // seam and padding texels have a position too. Static geometry, so once.
    const passes = getPasses();
    passes.renderPositionMap(
      gl,
      geometry,
      mesh.current.matrixWorld,
      targets.position,
    );

    // The dilation ping-pong needs a second target, but only for these two
    // passes. Keeping it local means it is freed immediately and, more to the
    // point, a re-run of this effect cannot render into a disposed one.
    const scratch = createPositionTarget(maskSize);
    for (let pass = 0; pass < DILATE_PASSES; pass += 1) {
      const from = pass % 2 === 0 ? targets.position : scratch;
      const to = pass % 2 === 0 ? scratch : targets.position;
      passes.dilateMaterial.uniforms.uMap.value = from.texture;
      passes.dilateMaterial.uniforms.uTexel.value.set(
        1 / maskSize,
        1 / maskSize,
      );
      passes.render(gl, passes.dilateMaterial, to, false);
    }
    scratch.dispose();

    const record = { mesh: mesh.current, splat, shedFrom };
    // Hung off the mesh so a raycast hit resolves to its surface in one step.
    mesh.current.userData.paintSurface = record;
    return registerSurface(id, record);
  }, [
    geometry,
    gl,
    gridX,
    gridY,
    id,
    maskSize,
    registerSurface,
    shedFrom,
    splat,
    targets,
  ]);

  useFrame((state, rawDelta) => {
    if (!cells.current) return;
    const passes = getPasses();
    const now = state.clock.getElapsedTime();
    const delta = Math.min(rawDelta, 1 / 30);

    while (pending.current.length > 0) {
      const shot = pending.current.pop();
      // Shared between the two stamps so the colour splat lands with exactly
      // the height splat's silhouette instead of its own random lobing.
      const seed = Math.random();

      const uniforms = passes.stampMaterial.uniforms;
      uniforms.uPositionMap.value = targets.position.texture;
      uniforms.uCenter.value.set(shot.cx, shot.cy, shot.cz);
      uniforms.uAxis.value.set(shot.ax, shot.ay, shot.az);
      uniforms.uRadius.value = shot.radius;
      uniforms.uStretch.value = shot.stretch;
      uniforms.uSeed.value = seed;
      passes.render(gl, passes.stampMaterial, targets.read, false);

      const colorUniforms = passes.colorStampMaterial.uniforms;
      colorUniforms.uPositionMap.value = targets.position.texture;
      colorUniforms.uCenter.value.set(shot.cx, shot.cy, shot.cz);
      colorUniforms.uAxis.value.set(shot.ax, shot.ay, shot.az);
      colorUniforms.uRadius.value = shot.radius;
      colorUniforms.uStretch.value = shot.stretch;
      colorUniforms.uSeed.value = seed;
      colorUniforms.uColor.value.set(shot.color);
      passes.render(gl, passes.colorStampMaterial, targets.colorRead, false);

      wetUntil.current = now + PAINT.wetSeconds;
      scoreDirty.current = true;
    }

    while (pendingSheds.current.length > 0) {
      const shot = pendingSheds.current.pop();
      const column = THREE.MathUtils.clamp(
        Math.floor(shot.u * gridX),
        0,
        gridX - 1,
      );
      const row = THREE.MathUtils.clamp(
        Math.floor(shot.v * gridY),
        0,
        gridY - 1,
      );
      travel.set(shot.dx, shot.dy, shot.dz);
      shedFromCell(cells.current[row * gridX + column], shot);
    }

    if (now < wetUntil.current) {
      const uniforms = passes.flowMaterial.uniforms;
      uniforms.uMask.value = targets.read.texture;
      uniforms.uTexel.value.set(1 / maskSize, 1 / maskSize);
      uniforms.uGrid.value.set(gridX, gridY);
      uniforms.uDelta.value = delta;
      for (let slot = 0; slot < MAX_ATLAS_CELLS; slot += 1) {
        const cell = cells.current[slot];
        uniforms.uFlow.value[slot].copy(cell ? cell.flow : { x: 0, y: 0 });
      }
      passes.render(gl, passes.flowMaterial, targets.write, false);

      // Colour flow reads the same pre-swap height mask the height flow just
      // used, so "is this texel wet and taller than upstream" agrees between
      // the two passes.
      const colorUniforms = passes.colorFlowMaterial.uniforms;
      colorUniforms.uColorMask.value = targets.colorRead.texture;
      colorUniforms.uWetMask.value = targets.read.texture;
      colorUniforms.uTexel.value.set(1 / maskSize, 1 / maskSize);
      colorUniforms.uGrid.value.set(gridX, gridY);
      colorUniforms.uDelta.value = delta;
      for (let slot = 0; slot < MAX_ATLAS_CELLS; slot += 1) {
        const cell = cells.current[slot];
        colorUniforms.uFlow.value[slot].copy(cell ? cell.flow : { x: 0, y: 0 });
      }
      passes.render(gl, passes.colorFlowMaterial, targets.colorWrite, false);

      const swap = targets.read;
      targets.read = targets.write;
      targets.write = swap;
      material.uniforms.paintMask.value = targets.read.texture;

      const colorSwap = targets.colorRead;
      targets.colorRead = targets.colorWrite;
      targets.colorWrite = colorSwap;
      material.uniforms.colorMask.value = targets.colorRead.texture;

      scoreDirty.current = true;
    }

    if (!scoreDirty.current || now - lastScore.current < SCORING.interval)
      return;
    lastScore.current = now;
    scoreDirty.current = false;

    const uniforms = passes.reduceMaterial.uniforms;
    uniforms.uMask.value = targets.read.texture;
    uniforms.uStep.value.set(
      1 / (REDUCE_SIZE * REDUCE_TAPS),
      1 / (REDUCE_SIZE * REDUCE_TAPS),
    );
    passes.render(gl, passes.reduceMaterial, targets.reduce, false);
    gl.readRenderTargetPixels(
      targets.reduce,
      0,
      0,
      REDUCE_SIZE,
      REDUCE_SIZE,
      scorePixels,
    );

    let total = 0;
    for (let pixel = 0; pixel < scorePixels.length; pixel += 4)
      total += scorePixels[pixel];
    onCoverage(id, total / (255 * REDUCE_SIZE * REDUCE_SIZE), weight);
  });

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
    />
  );
}
