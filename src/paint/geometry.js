import * as THREE from 'three'
import { MAX_ATLAS_CELLS } from './passes.js'

const CELL_INSET = 0.03

// BoxGeometry gives all six faces the same 0..1 UVs, so a single mask would
// paint every face at once. Repack each face into its own cell of a 3x2 atlas.
export function createAtlasBoxGeometry(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.getAttribute('uv')
  const verticesPerFace = uv.count / MAX_ATLAS_CELLS

  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    const face = Math.floor(vertex / verticesPerFace)
    const column = face % 3
    const row = Math.floor(face / 3)
    const u = THREE.MathUtils.lerp(CELL_INSET, 1 - CELL_INSET, uv.getX(vertex))
    const v = THREE.MathUtils.lerp(CELL_INSET, 1 - CELL_INSET, uv.getY(vertex))
    uv.setXY(vertex, (column + u) / 3, (row + v) / 2)
  }

  uv.needsUpdate = true
  return geometry
}

// One entry per atlas cell: the world-space tangent frame behind that patch of
// UV space, which is what lets a stamp stay round and a drip run downhill.
export function analyzeCells(geometry, gridX, gridY) {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3
  const cells = new Array(gridX * gridY).fill(null)
  // Two rectangles per cell, and they are not interchangeable:
  //
  //   min/max          the whole cell, padding included. Stamps clip to this so
  //                    ink may run slightly past the visible edge of the face —
  //                    without that overhang the last texels fade out and every
  //                    face border renders with an unpainted sliver.
  //   faceMin/faceMax  the UVs the geometry actually occupies, inset inside the
  //                    cell by createAtlasBoxGeometry. Only the shed prediction
  //                    uses this, because that needs the real lip of the face.
  const extents = new Array(gridX * gridY).fill(null)

  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const uvCorner = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()]
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const deltaUv1 = new THREE.Vector2()
  const deltaUv2 = new THREE.Vector2()

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let point = 0; point < 3; point += 1) {
      const vertex = index ? index.getX(triangle * 3 + point) : triangle * 3 + point
      corner[point].fromBufferAttribute(position, vertex)
      uvCorner[point].fromBufferAttribute(uv, vertex)
    }

    const centerU = (uvCorner[0].x + uvCorner[1].x + uvCorner[2].x) / 3
    const centerV = (uvCorner[0].y + uvCorner[1].y + uvCorner[2].y) / 3
    const column = THREE.MathUtils.clamp(Math.floor(centerU * gridX), 0, gridX - 1)
    const row = THREE.MathUtils.clamp(Math.floor(centerV * gridY), 0, gridY - 1)
    const cellIndex = row * gridX + column

    let extent = extents[cellIndex]
    if (!extent) {
      extent = { minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity }
      extents[cellIndex] = extent
    }
    for (const vertexUv of uvCorner) {
      extent.minU = Math.min(extent.minU, vertexUv.x)
      extent.minV = Math.min(extent.minV, vertexUv.y)
      extent.maxU = Math.max(extent.maxU, vertexUv.x)
      extent.maxV = Math.max(extent.maxV, vertexUv.y)
    }

    if (cells[cellIndex]) continue

    edge1.subVectors(corner[1], corner[0])
    edge2.subVectors(corner[2], corner[0])
    deltaUv1.subVectors(uvCorner[1], uvCorner[0])
    deltaUv2.subVectors(uvCorner[2], uvCorner[0])

    const determinant = deltaUv1.x * deltaUv2.y - deltaUv2.x * deltaUv1.y
    if (Math.abs(determinant) < 1e-9) continue
    const inverse = 1 / determinant

    cells[cellIndex] = {
      // Metres of world movement per unit of UV, along each axis.
      tangent: new THREE.Vector3()
        .copy(edge1).multiplyScalar(deltaUv2.y)
        .addScaledVector(edge2, -deltaUv1.y)
        .multiplyScalar(inverse),
      bitangent: new THREE.Vector3()
        .copy(edge2).multiplyScalar(deltaUv1.x)
        .addScaledVector(edge1, -deltaUv2.x)
        .multiplyScalar(inverse),
      normal: new THREE.Vector3().crossVectors(edge1, edge2).normalize(),
      // A known point on the cell plane and its UV, which together with the
      // tangent frame turn any UV back into a world position.
      origin: corner[0].clone(),
      originUv: uvCorner[0].clone(),
      min: new THREE.Vector2(column / gridX, row / gridY),
      max: new THREE.Vector2((column + 1) / gridX, (row + 1) / gridY),
    }
  }

  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
    const cell = cells[cellIndex]
    const extent = extents[cellIndex]
    if (!cell || !extent) continue
    cell.faceMin = new THREE.Vector2(extent.minU, extent.minV)
    cell.faceMax = new THREE.Vector2(extent.maxU, extent.maxV)
  }

  return cells
}

const DOWN = new THREE.Vector3(0, -1, 0)

// Resolve each cell's frame into world space and derive the two things the
// paint system actually consumes: stamp scale and drip direction.
export function resolveCells(cells, matrixWorld, dripSpeed) {
  // Directions take only the rotation; the origin takes the full transform.
  const quaternion = new THREE.Quaternion()
  matrixWorld.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3())

  const tangent = new THREE.Vector3()
  const bitangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const downhill = new THREE.Vector3()

  return cells.map((cell) => {
    if (!cell) {
      return {
        uvPerMeter: new THREE.Vector2(1, 1),
        flow: new THREE.Vector2(),
        tangent: new THREE.Vector3(1, 0, 0),
        bitangent: new THREE.Vector3(0, 0, 1),
        normal: new THREE.Vector3(0, 1, 0),
        originWorld: new THREE.Vector3(),
        originUv: new THREE.Vector2(),
        min: new THREE.Vector2(0, 0),
        max: new THREE.Vector2(1, 1),
        faceMin: new THREE.Vector2(0, 0),
        faceMax: new THREE.Vector2(1, 1),
      }
    }

    tangent.copy(cell.tangent).applyQuaternion(quaternion)
    bitangent.copy(cell.bitangent).applyQuaternion(quaternion)
    normal.copy(cell.normal).applyQuaternion(quaternion)

    // World-down with the face normal projected out: nothing left means a
    // horizontal surface, where ink pools instead of running.
    downhill.copy(DOWN).addScaledVector(normal, -DOWN.dot(normal))
    const flow = new THREE.Vector2()
    if (downhill.lengthSq() > 0.0025) {
      downhill.normalize()
      flow.set(
        (downhill.dot(tangent) / tangent.lengthSq()) * dripSpeed,
        (downhill.dot(bitangent) / bitangent.lengthSq()) * dripSpeed,
      )
    }

    return {
      uvPerMeter: new THREE.Vector2(1 / tangent.length(), 1 / bitangent.length()),
      flow,
      // Kept in world space so an impact direction can be resolved into this
      // cell's UV axes when a splat is stamped.
      tangent: tangent.clone(),
      bitangent: bitangent.clone(),
      normal: normal.clone(),
      originWorld: cell.origin.clone().applyMatrix4(matrixWorld),
      originUv: cell.originUv.clone(),
      min: cell.min.clone(),
      max: cell.max.clone(),
      faceMin: cell.faceMin.clone(),
      faceMax: cell.faceMax.clone(),
    }
  })
}

// Any UV inside a cell back to the world point it sits on. Cells are planar, so
// the tangent frame is exact rather than an approximation.
export function cellPointToWorld(cell, u, v, target) {
  return target
    .copy(cell.originWorld)
    .addScaledVector(cell.tangent, u - cell.originUv.x)
    .addScaledVector(cell.bitangent, v - cell.originUv.y)
}
