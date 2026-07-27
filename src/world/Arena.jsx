import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import PaintableSurface from '../paint/PaintableSurface.jsx'
import { createAtlasBoxGeometry } from '../paint/geometry.js'
import { ARENA, PAINT } from '../settings.js'
import Skybox from './Skybox.jsx'

// Everything a level is made of: its sky, its light, and its paintable
// surfaces. Remounted on each run (via a key) so every mask starts clean.
export default function Arena({ level = ARENA, onCoverage, onSpray, registerSurface }) {
  const floorGeometry = useMemo(
    () => new THREE.PlaneGeometry(level.floorSize, level.floorSize),
    [level],
  )

  const blockGeometries = useMemo(
    () => level.blocks.map(([, , , width, height, depth]) =>
      createAtlasBoxGeometry(width, height, depth)),
    [level],
  )

  useEffect(() => () => {
    floorGeometry.dispose()
    for (const geometry of blockGeometries) geometry.dispose()
  }, [blockGeometries, floorGeometry])

  return (
    <>
      <Skybox level={level} />
      <ambientLight intensity={level.ambientIntensity} />
      <directionalLight position={level.lightDirection} intensity={level.sunIntensity} />

      <PaintableSurface
        id="floor"
        geometry={floorGeometry}
        gridX={1}
        gridY={1}
        worldSpan={level.floorSize}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        baseColor={level.floorColor}
        inkColor={PAINT.color}
        lightDirection={level.lightDirection}
        weight={level.floorSize * level.floorSize}
        onCoverage={onCoverage}
        onSpray={onSpray}
        registerSurface={registerSurface}
      />

      {level.blocks.map(([x, y, z, width, height, depth], index) => (
        <PaintableSurface
          key={index}
          id={`block-${index}`}
          geometry={blockGeometries[index]}
          gridX={3}
          gridY={2}
          worldSpan={3 * Math.max(width, height, depth)}
          position={[x, y, z]}
          baseColor={level.blockColors[index % level.blockColors.length]}
          inkColor={PAINT.color}
          lightDirection={level.lightDirection}
          weight={2 * (width * height + width * depth + height * depth)}
          onCoverage={onCoverage}
          onSpray={onSpray}
          registerSurface={registerSurface}
        />
      ))}

      <GoalPad />
    </>
  )
}

// Not paintable — just a landmark to orient by.
function GoalPad() {
  return (
    <mesh position={[0, 0.12, -15]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[3.5, 40]} />
      <meshStandardMaterial color="#e9bc4a" emissive="#9d711b" emissiveIntensity={0.3} />
    </mesh>
  )
}
