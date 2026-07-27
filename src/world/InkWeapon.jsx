import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { PROJECTILE_CAPACITY } from '../settings.js'

// Ink is a projectile, not a hitscan ray: it leaves the muzzle at the weapon's
// speed, falls under the weapon's gravity, and each frame the segment it just
// travelled is swept against the world. That single change is what gives a tool
// its reach, its arc, and a splat whose size depends on how far the ink flew.
export default function InkWeapon({ weapon, paintEnabled, ink, surfaces, paint, onInkUse, onSync }) {
  const { camera, gl, clock } = useThree()
  const held = useRef(false)
  const chargeStarted = useRef(null)
  const lastShot = useRef(0)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const meshes = useMemo(() => [], [])
  const scratch = useMemo(() => ({
    direction: new THREE.Vector3(),
    jitter: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    segment: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    normalMatrix: new THREE.Matrix3(),
  }), [])

  const projectiles = useMemo(() => Array.from({ length: PROJECTILE_CAPACITY }, () => ({
    alive: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    radius: 0,
    fullVisualRadius: 0,
    visualRadius: 0,
    distance: 0,
    age: 0,
  })), [])

  const fire = useCallback((charge, inkCost) => {
    if (!paintEnabled || ink < inkCost) return false
    const shot = projectiles.find((candidate) => !candidate.alive)
    if (!shot) return false

    camera.getWorldDirection(scratch.direction)
    const spread = charge > 0 ? weapon.chargeSpread : weapon.spread
    scratch.jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    scratch.direction.addScaledVector(scratch.jitter, spread).normalize()

    shot.alive = true
    shot.position.copy(camera.position).addScaledVector(scratch.direction, 0.55)
    shot.position.y -= 0.17
    shot.velocity.copy(scratch.direction).multiplyScalar(weapon.muzzleSpeed * (1 + charge * weapon.chargeSpeedScale))
    shot.radius = weapon.radius * (1 + charge * weapon.chargeRadiusScale)
    shot.fullVisualRadius = shot.radius * weapon.projectileRadiusScale
    shot.visualRadius = 0
    shot.distance = 0
    shot.age = 0

    onInkUse(inkCost)
    return true
  }, [camera, ink, onInkUse, paintEnabled, projectiles, scratch, weapon])

  // The pointer listeners are attached once and reach the current shot function
  // through a ref, rather than being torn down on every re-render.
  const fireNow = useRef(null)
  fireNow.current = fire

  useEffect(() => {
    const down = (event) => {
      if (!gl.domElement.contains(event.target)) return
      if (event.button === 0) held.current = true
      if (event.button === 2) chargeStarted.current = clock.getElapsedTime()
    }
    const up = (event) => {
      if (event.button === 0) held.current = false
      if (event.button === 2 && chargeStarted.current !== null) {
        const chargeTime = clock.getElapsedTime() - chargeStarted.current
        chargeStarted.current = null
        if (chargeTime > 0.08) fireNow.current(Math.min(1, chargeTime * 0.8), weapon.chargeInkCost)
      }
    }
    const blockContextMenu = (event) => {
      if (gl.domElement.contains(event.target)) event.preventDefault()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    window.addEventListener('contextmenu', blockContextMenu)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('contextmenu', blockContextMenu)
    }
  }, [clock, gl, weapon])

  useFrame((state, rawDelta) => {
    const now = state.clock.getElapsedTime()
    const delta = Math.min(rawDelta, 1 / 30)

    if (held.current && paintEnabled && now - lastShot.current >= weapon.fireInterval) {
      if (fire(0, weapon.inkCost)) lastShot.current = now
    }

    meshes.length = 0
    for (const surface of surfaces.current.values()) meshes.push(surface.mesh)

    for (const shot of projectiles) {
      if (!shot.alive) continue

      scratch.previous.copy(shot.position)
      shot.velocity.y -= weapon.gravity * delta
      shot.position.addScaledVector(shot.velocity, delta)
      shot.age += delta

      // Sweep the segment just travelled so a fast shot cannot tunnel through a
      // thin surface between frames.
      scratch.segment.subVectors(shot.position, scratch.previous)
      const travelled = scratch.segment.length()
      shot.distance += travelled

      // The ball spawns barely half a metre from the eye, so at full size it
      // would black out the screen on every shot. Grow it in over the first
      // stretch of flight instead.
      shot.visualRadius = shot.fullVisualRadius * Math.min(1, shot.distance / weapon.emergenceDistance)

      if (travelled > 1e-6 && meshes.length > 0) {
        scratch.segment.divideScalar(travelled)
        raycaster.set(scratch.previous, scratch.segment)
        raycaster.near = 0
        raycaster.far = travelled
        const hits = raycaster.intersectObjects(meshes, false)
        const hit = hits[0]
        if (hit) {
          // Ink disperses in flight, so a long shot lands wider than a close one.
          const radius = Math.min(weapon.maxRadius, shot.radius + weapon.radiusPerMetre * shot.distance)

          // Grazing impacts smear along the direction of travel; head-on ones
          // stamp a disc. The normal comes back in object space.
          let stretch = 1
          if (hit.face) {
            scratch.normalMatrix.getNormalMatrix(hit.object.matrixWorld)
            scratch.normal.copy(hit.face.normal).applyMatrix3(scratch.normalMatrix).normalize()
            const incidence = Math.abs(scratch.segment.dot(scratch.normal))
            stretch = THREE.MathUtils.clamp(1 / Math.max(incidence, 0.2), 1, weapon.maxStretch)
          }

          paint(hit.point, radius, scratch.segment, stretch)
          const surface = hit.object.userData.paintSurface
          if (surface && hit.uv) surface.shedFrom(hit.uv, radius, scratch.segment)

          shot.alive = false
          continue
        }
      }

      if (shot.age >= weapon.lifetime || shot.position.y < -4) shot.alive = false
    }

    // Run after impacts are resolved so a ball is gone on the same frame its
    // splat appears, rather than flying on through the surface.
    onSync(projectiles)
  })

  return null
}
