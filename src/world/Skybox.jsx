import { Suspense, useEffect, useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { RGBELoader } from "three-stdlib";
import * as THREE from "three";
import { PAINT } from "../settings.js";
import { useSkyReflection } from "./SkyReflection.jsx";

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
//     cubemap from the HDR. The ink samples this map itself as a plain equirect
//     texture, so that cubemap would be pure VRAM cost.
//   * Nothing caps the texture size. A 4096x2048 HDR is 134MB of VRAM, and this
//     game already holds tens of MB of paint masks and position maps. Together
//     that is enough to lose the WebGL context — which takes the whole React
//     tree with it, so the symptom is a blank screen rather than anything that
//     names a texture.
//
// So the HDR is resampled on the CPU while it is still a plain array, and only
// the small versions are ever uploaded.

// Box filter in linear light, which is correct precisely because the source is
// HDR and has not been gamma encoded. Returns null when no resize is needed.
function downsample(source, maxWidth) {
  const { data, width, height } = source.image;
  const factor = Math.max(1, Math.floor(width / maxWidth));
  if (factor === 1) return null;

  const outWidth = Math.floor(width / factor);
  const outHeight = Math.floor(height / factor);
  const out = new Float32Array(outWidth * outHeight * 4);
  const samples = factor * factor;

  for (let y = 0; y < outHeight; y += 1) {
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
      const target = (y * outWidth + x) * 4;
      out[target] = r / samples;
      out[target + 1] = g / samples;
      out[target + 2] = b / samples;
      out[target + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(
    out,
    outWidth,
    outHeight,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping; // the seam wraps around the horizon
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Two maps out of one decode: the background you look at, and a heavily blurred
// copy the ink mirrors. Resampling that hard *is* the blur — glossy paint wants
// a soft reflection, and a 96px-wide map costs about 70KB.
function useSkyMaps(url) {
  const source = useLoader(RGBELoader, url, (loader) =>
    loader.setDataType(THREE.FloatType),
  );

  return useMemo(() => {
    const background = downsample(source, PAINT.skyboxMaxWidth);
    const reflection = downsample(source, PAINT.reflectionWidth);

    if (!background) {
      source.mapping = THREE.EquirectangularReflectionMapping;
    } else {
      // Nothing kept the full-resolution copy, and it was never uploaded, so
      // this only frees the decoded array.
      source.dispose();
    }

    return { background: background ?? source, reflection };
  }, [source]);
}

function HdrSky({ url }) {
  const { background, reflection } = useSkyMaps(url);
  const scene = useThree((state) => state.scene);
  const { publish } = useSkyReflection();

  useEffect(() => {
    const previous = scene.background;
    scene.background = background;
    return () => {
      scene.background = previous;
      background.dispose();
    };
  }, [background, scene]);

  useEffect(() => {
    if (!reflection) return undefined;
    publish(reflection);
    return () => {
      publish(null);
      reflection.dispose();
    };
  }, [publish, reflection]);

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
      <HdrSky url={level.skybox} />
    </Suspense>
  );
}
