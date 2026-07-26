import * as THREE from 'three'
import { analyzeCells, cellPointToWorld, createAtlasBoxGeometry, resolveCells } from './src/paint/geometry.js'
import { PAINT, WEAPONS } from './src/settings.js'

const [W, H, D] = [3, 6, 3]
const CENTRE = new THREE.Vector3(0, 3, 0) // tall block: base at y = 0
const weapon = WEAPONS.standard

const geometry = createAtlasBoxGeometry(W, H, D)
const matrixWorld = new THREE.Matrix4().makeTranslation(CENTRE.x, CENTRE.y, CENTRE.z)
const cells = resolveCells(analyzeCells(geometry, 3, 2), matrixWorld, PAINT.dripSpeed)

let failures = 0
const point = new THREE.Vector3()
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

// The stamp clip rect must stay wider than the face, or edges render unpainted.
console.log('-- clip rect must overhang the face --')
cells.forEach((cell, i) => {
  const pads = cell.min.x < cell.faceMin.x && cell.min.y < cell.faceMin.y
    && cell.max.x > cell.faceMax.x && cell.max.y > cell.faceMax.y
  check(`cell ${i} clip rect overhangs face`, pads,
    `clip u[${cell.min.x.toFixed(3)},${cell.max.x.toFixed(3)}] face u[${cell.faceMin.x.toFixed(3)},${cell.faceMax.x.toFixed(3)}]`)
})

// Replicate shedFromCell exactly, for a splat at a range of heights up the face.
function shed(cell, radius, heightUpFace) {
  const speed = cell.flow.length()
  if (speed < 1e-5) return null
  const dU = cell.flow.x / speed
  const dV = cell.flow.y / speed

  // Place the splat centre `heightUpFace` metres above the base of the face.
  const v = cell.faceMin.y + (cell.faceMax.y - cell.faceMin.y) * (heightUpFace / H)
  const u = (cell.faceMin.x + cell.faceMax.x) / 2

  let toEdge = Infinity
  if (dU > 1e-6) toEdge = Math.min(toEdge, (cell.faceMax.x - u) / dU)
  else if (dU < -1e-6) toEdge = Math.min(toEdge, (cell.faceMin.x - u) / dU)
  if (dV > 1e-6) toEdge = Math.min(toEdge, (cell.faceMax.y - v) / dV)
  else if (dV < -1e-6) toEdge = Math.min(toEdge, (cell.faceMin.y - v) / dV)
  if (!Number.isFinite(toEdge) || toEdge < 0) return null

  const radiusUv = radius * Math.hypot(dU * cell.uvPerMeter.x, dV * cell.uvPerMeter.y)
  const toCreep = Math.max(0, toEdge - radiusUv)
  if (toCreep > speed * PAINT.wetSeconds) return null

  cellPointToWorld(cell, u + dU * toEdge, v + dV * toEdge, point)
  return { y: point.y, delay: toCreep / speed }
}

const side = cells.find((c) => Math.abs(c.normal.z - 1) < 1e-6)
const radius = Math.min(weapon.maxRadius, weapon.radius + weapon.radiusPerMetre * 10)
console.log(`\n-- shedding from the +Z face, splat radius ${radius.toFixed(2)}m --`)
for (const height of [0.3, 1.0, 1.7, 2.4, 3.0, 4.5]) {
  const result = shed(side, radius, height)
  console.log(result
    ? `  splat ${height}m up -> sheds at y=${result.y.toFixed(4)} after ${result.delay.toFixed(2)}s`
    : `  splat ${height}m up -> no shed`)
}

check('a splat across the lip sheds immediately', (() => {
  const r = shed(side, radius, 0.3)
  return r && r.delay < 0.01 && Math.abs(r.y) < 1e-3
})(), 'this is the case that silently returned before')

check('a splat within creep range sheds with a delay', (() => {
  const r = shed(side, radius, 2.2)
  return r && r.delay > 0.01 && Math.abs(r.y) < 1e-3
})())

check('a splat high up the face does not shed', shed(side, radius, 4.5) === null)

const top = cells.find((c) => Math.abs(c.normal.y - 1) < 1e-6)
check('horizontal faces never shed', shed(top, radius, 1) === null)

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
