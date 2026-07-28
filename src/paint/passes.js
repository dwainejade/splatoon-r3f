import * as THREE from 'three'
import { PAINT } from '../settings.js'
import {
  colorFlowFragmentShader,
  colorStampFragmentShader,
  dilateFragmentShader,
  flowFragmentShader,
  fullscreenVertexShader,
  positionFragmentShader,
  positionVertexShader,
  reduceFragmentShader,
  stampFragmentShader,
} from './shaders.js'

export const MAX_ATLAS_CELLS = 6

// Stamp, flow and reduce all render one quad at a time into a surface's mask.
// The passes are stateless between draws, so every surface shares one set and
// simply overwrites the uniforms before its own render.
let passes = null

export function getPasses() {
  if (passes) return passes

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.PlaneGeometry(2, 2)

  const stampMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPositionMap: { value: null },
      uCenter: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(1, 0, 0) },
      uRadius: { value: 1 },
      uStretch: { value: 1 },
      uSeed: { value: 0 },
      uLobeAmount: { value: PAINT.lobeAmount },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: stampFragmentShader,
    depthTest: false,
    depthWrite: false,
    // Max-blend so overlapping splats merge into one body of ink instead of
    // compounding into a brighter, thicker blob at every intersection.
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  })

  // Paints the colour mask for the same splat. Kept as a separate draw rather
  // than a second render target on the stamp pass because it blends
  // differently: colour should replace, not max, or a colour with a low R/G/B
  // value could never overwrite what is already there.
  const colorStampMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPositionMap: { value: null },
      uCenter: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(1, 0, 0) },
      uRadius: { value: 1 },
      uStretch: { value: 1 },
      uSeed: { value: 0 },
      uLobeAmount: { value: PAINT.lobeAmount },
      uColor: { value: new THREE.Color(PAINT.color) },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: colorStampFragmentShader,
    depthTest: false,
    depthWrite: false,
    // Alpha-blend using the splat's own coverage as alpha: a soft edge fades
    // the new colour into the old one instead of hard-cutting at the splat
    // boundary, and a fresh coat over old ink still ends up fully the new
    // colour where the splat is solid.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })

  const dilateMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uTexel: { value: new THREE.Vector2() },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: dilateFragmentShader,
    depthTest: false,
    depthWrite: false,
  })

  const flowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uFlow: { value: Array.from({ length: MAX_ATLAS_CELLS }, () => new THREE.Vector2()) },
      uDelta: { value: 0 },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: flowFragmentShader,
    depthTest: false,
    depthWrite: false,
  })

  // Drags the colour mask downhill in lockstep with the height mask, sampling
  // wetness from the height mask so a run carries the colour of the ink that
  // is actually flowing rather than fading it back toward its own old colour.
  const colorFlowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColorMask: { value: null },
      uWetMask: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uFlow: { value: Array.from({ length: MAX_ATLAS_CELLS }, () => new THREE.Vector2()) },
      uDelta: { value: 0 },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: colorFlowFragmentShader,
    depthTest: false,
    depthWrite: false,
  })

  const reduceMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: null },
      uStep: { value: new THREE.Vector2() },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader: reduceFragmentShader,
    depthTest: false,
    depthWrite: false,
  })

  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(quad, stampMaterial)
  mesh.frustumCulled = false
  scene.add(mesh)

  // Rendered with the paintable mesh itself rather than the shared quad, since
  // this pass rasterises the model unwrapped into its own UV space.
  const positionMaterial = new THREE.ShaderMaterial({
    vertexShader: positionVertexShader,
    fragmentShader: positionFragmentShader,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  passes = {
    camera,
    scene,
    mesh,
    stampMaterial,
    colorStampMaterial,
    dilateMaterial,
    positionMaterial,
    flowMaterial,
    colorFlowMaterial,
    reduceMaterial,
    // The position pass is the one thing that cannot use the shared quad: it
    // has to rasterise the paintable mesh itself, unwrapped into its own UVs.
    renderPositionMap(renderer, geometry, matrixWorld, target) {
      const unwrapped = new THREE.Mesh(geometry, positionMaterial)
      unwrapped.frustumCulled = false
      unwrapped.matrixAutoUpdate = false
      unwrapped.matrix.copy(matrixWorld)
      unwrapped.updateMatrixWorld(true)

      const unwrapScene = new THREE.Scene()
      unwrapScene.add(unwrapped)

      const previousTarget = renderer.getRenderTarget()
      const previousColor = renderer.getClearColor(new THREE.Color())
      const previousAlpha = renderer.getClearAlpha()
      renderer.setRenderTarget(target)
      // Alpha zero everywhere means "no mesh here" until the pass says otherwise.
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
      renderer.render(unwrapScene, camera)
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(previousColor, previousAlpha)

      unwrapScene.remove(unwrapped)
    },
    render(renderer, material, target, clear) {
      mesh.material = material
      const previousTarget = renderer.getRenderTarget()
      const previousAutoClear = renderer.autoClear
      renderer.autoClear = clear
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(previousTarget)
      renderer.autoClear = previousAutoClear
    },
  }
  return passes
}

// Holds a world position per texel, so RGBA8 is nowhere near enough range.
// Full float specifically: RGBA16F is half the memory and precise enough, but
// rendering into it loses the WebGL context on some drivers where RGBA32F is
// fine. Verified by readback, so leave it alone without testing the swap.
export function createPositionTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

export function createMaskTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

// RGB of the ink actually sitting in each texel. Same layout as the height
// mask so the two can be sampled with one UV and ping-ponged in lockstep.
export function createColorTarget(size) {
  return createMaskTarget(size)
}

// Mask resolution follows world size so a 42m floor and a 3m crate end up with
// comparable texel density instead of both getting a fixed 256px mask.
export function pickMaskSize(worldSpan, texelsPerMeter = PAINT.texelsPerMetre) {
  const wanted = worldSpan * texelsPerMeter
  const power = Math.ceil(Math.log2(Math.max(1, wanted)))
  return THREE.MathUtils.clamp(2 ** power, 256, 1024)
}
