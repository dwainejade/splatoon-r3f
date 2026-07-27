import { Suspense, useEffect, useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { RGBELoader } from "three-stdlib";
import * as THREE from "three";
import { PAINT } from "../settings.js";

// Per-level sky. A level either names an .hdr under public/ or gets the
// procedural gradient instead.
//
// This deliberately does not use drei's <Environment>. Three reasons, and the
// third is the one that actually kills the renderer:
//
//   * The prop for your own file is `files`, not `preset`. `preset` takes a
//     name from drei's fixed list ('sunset', 'dawn', …) and throws on anything
//     else, so a path there fails before the loader ever runs.
//   * <Environment> also sets scene.environment, and three then builds a PMREM
//     cubemap from the HDR. Every paintable surface here is a raw ShaderMaterial
//     and ignores scene.environment, so that cubemap is pure VRAM cost.
//   * Nothing caps the texture size. A 4096x2048 HDR is 67MB of VRAM as a
//     half-float RGBA texture, and this game already holds tens of MB of paint
//     masks and position maps. Together that is enough to lose the WebGL
//     context — which takes the whole React tree down with it, so the symptom
//     is a blank screen and "the paint is gone" rather than anything that
//     names a texture.
//
// So the HDR is downsampled on the CPU while it is still a plain array, and
// only the small version is ever uploaded. A background skybox needs nothing
// like source resolution — it is viewed at roughly one texel per pixel.
function useSkyTexture(url, maxWidth) {
  const source = useLoader(RGBELoader, url, (loader) =>
    loader.setDataType(THREE.FloatType),
  );

  return useMemo(() => {
    const { data, width, height } = source.image;
    const factor = Math.max(1, Math.floor(width / maxWidth));

    if (factor === 1) {
      source.mapping = THREE.EquirectangularReflectionMapping;
      return source;
    }

    const outWidth = Math.floor(width / factor);
    const outHeight = Math.floor(height / factor);
    const out = new Float32Array(outWidth * outHeight * 4);

    // Box filter. Averaging in linear light is correct here precisely because
    // the source is HDR and has not been gamma encoded.
    for (let y = 0; y < outHeight; y -= 1) {
      for (let x = 0; x < outWidth; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sampleY = 0; sampleY < factor; sampleY += 1) {
          for (let sampleX = 0; sampleX < factor; sampleX += 1) {
            const index =
              ((y * factor + sampleY) * width + x * factor + sampleX) * 4;
            r += data[index];
            g += data[index + 1];
            b += data[index + 2];
          }
        }
        const samples = factor * factor;
        const target = (y * outWidth + x) * 4;
        out[target] = r / samples;
        out[target + 1] = g / samples;
        out[target + 2] = b / samples;
        out[target + 3] = 1;
      }
    }

    const small = new THREE.DataTexture(
      out,
      outWidth,
      outHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    small.mapping = THREE.EquirectangularReflectionMapping;
    small.colorSpace = THREE.LinearSRGBColorSpace;
    small.minFilter = THREE.LinearFilter;
    small.magFilter = THREE.LinearFilter;
    small.needsUpdate = true;
    // The full-resolution one was never uploaded, so this only frees the array.
    source.dispose();
    return small;
  }, [maxWidth, source]);
}

function HdrSky({ url, maxWidth }) {
  const texture = useSkyTexture(url, maxWidth);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const previous = scene.background;
    scene.background = texture;
    return () => {
      scene.background = previous;
      texture.dispose();
    };
  }, [scene, texture]);

  return null;
}

export default function Skybox({ level }) {
  if (!level.skybox) {
    return <Sky sunPosition={level.lightDirection} distance={1000} />;
  }

  // Its own boundary, so the level renders immediately and the sky appears once
  // the HDR has streamed in rather than the whole arena waiting on it.
  return (
    <Suspense fallback={null}>
      <HdrSky url={level.skybox} maxWidth={PAINT.skyboxMaxWidth} />
    </Suspense>
  );
}
