// Every paint mask is an RGBA8 texture in the surface's UV space:
//   R = ink height  (thresholded at 0.5 to get coverage, gradient drives the normal)
//   G = fresh       (decays over ~150ms; raises the threshold so splats grow in)
//   B = wet         (decays over ~3s; drives sheen, drips and surface tension)

const noise2d = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave += 1) {
      value += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }
`

// Painting is done in world space, not UV space.
//
// A splat is a sphere in the world. Every texel of a mask knows where it sits
// in 3D (see the position map below), so painting is just "is this texel within
// the splat sphere". That is what lets ink wrap around an edge or a corner: the
// texels on both faces are inside the same sphere, and neither knows or cares
// that they belong to different faces. Stamping a quad at the hit UV — the
// obvious approach — cannot do this, because a quad in UV space stops dead at
// the boundary of its face.

// Pass 1: rasterise the mesh unwrapped into its own UV space and write out the
// world position of every texel. Static geometry only needs this once.
export const positionVertexShader = `
  varying vec3 vWorldPosition;
  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`

export const positionFragmentShader = `
  varying vec3 vWorldPosition;
  void main() {
    // Alpha marks this texel as actually belonging to the mesh.
    gl_FragColor = vec4(vWorldPosition, 1.0);
  }
`

// Pass 2: bleed the position map outwards into texels the rasteriser missed.
// Without this, UV seams and the padding around each atlas face have no world
// position, so they can never be painted — which shows up as an unpainted
// outline tracing every face.
export const dilateFragmentShader = `
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec4 here = texture2D(uMap, vUv);
    if (here.a > 0.5) {
      gl_FragColor = here;
      return;
    }
    vec3 total = vec3(0.0);
    float count = 0.0;
    for (int y = -1; y <= 1; y += 1) {
      for (int x = -1; x <= 1; x += 1) {
        vec4 neighbour = texture2D(uMap, vUv + vec2(float(x), float(y)) * uTexel);
        total += neighbour.rgb * neighbour.a;
        count += neighbour.a;
      }
    }
    gl_FragColor = count < 0.5 ? vec4(0.0) : vec4(total / count, 1.0);
  }
`

// Pass 3: the splat itself. Runs over the whole mask, keeping only texels whose
// world position falls inside the splat.
export const stampFragmentShader = `
  uniform sampler2D uPositionMap;
  uniform vec3 uCenter;
  uniform vec3 uAxis;
  uniform float uRadius;
  uniform float uStretch;
  uniform float uSeed;
  uniform float uLobeAmount;
  varying vec2 vUv;
  ${noise2d}
  void main() {
    vec4 encoded = texture2D(uPositionMap, vUv);
    if (encoded.a < 0.5) discard;

    vec3 offset = encoded.xyz - uCenter;

    // Stretch along the direction of travel so a grazing hit smears. Done in
    // world space, so the smear carries on around a corner instead of stopping.
    float along = dot(offset, uAxis);
    vec3 shaped = (offset - uAxis * along) + uAxis * (along / uStretch);
    float distance = length(shaped) / uRadius;
    if (distance > 1.25) discard;

    // Lobed boundary driven by the 3D direction out of the splat centre, so the
    // outline stays continuous as it bends over an edge.
    vec3 direction = normalize(shaped + vec3(1e-5));
    float lobes = fbm(direction.xy * 2.4 + direction.z * 1.7 + uSeed * 17.0);
    float radius = 0.66 + (lobes - 0.5) * uLobeAmount;
    float body = smoothstep(radius, radius - 0.18, distance);

    // Satellites sit on a sphere around the splat. The ones that happen to fall
    // near the surface land; the rest simply miss, which is what real spatter
    // does anyway.
    float satellites = 0.0;
    vec3 local = shaped / uRadius;
    for (int drop = 0; drop < 6; drop += 1) {
      float index = float(drop);
      float spin = hash(vec2(uSeed, index)) * 6.2831853;
      float tilt = hash(vec2(index, uSeed)) * 3.14159265;
      float orbit = 0.72 + hash(vec2(uSeed + index, 7.3)) * 0.34;
      float size = 0.07 + hash(vec2(uSeed + index, 3.1)) * 0.11;
      vec3 satellite = vec3(cos(spin) * sin(tilt), sin(spin) * sin(tilt), cos(tilt)) * orbit;
      satellites = max(satellites, smoothstep(size, size * 0.3, length(local - satellite)));
    }

    float mask = max(body, satellites * 0.88);
    if (mask <= 0.002) discard;

    // Domed profile, peaking just under 1.0 so an 8-bit mask keeps the whole dome.
    float height = mask * (0.64 + 0.34 * smoothstep(radius, 0.0, distance));
    gl_FragColor = vec4(height, 1.0, 1.0, 1.0);
  }
`

export const fullscreenVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Runs once per frame per surface while any ink is still wet.
export const flowFragmentShader = `
  uniform sampler2D uMask;
  uniform vec2 uTexel;
  uniform vec2 uGrid;
  uniform vec2 uFlow[6];
  uniform float uDelta;
  varying vec2 vUv;

  void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 cellMin = cell / uGrid + uTexel;
    vec2 cellMax = (cell + 1.0) / uGrid - uTexel;
    int cellIndex = int(cell.y * uGrid.x + cell.x);

    vec2 flow = vec2(0.0);
    for (int slot = 0; slot < 6; slot += 1) {
      if (slot == cellIndex) flow = uFlow[slot];
    }

    vec4 here = texture2D(uMask, vUv);
    float height = here.r;
    float fresh = here.g;
    float wet = here.b;

    // Drip: pull ink down from upstream, but only where it is still wet, so
    // runs freeze in place once the paint dries instead of creeping forever.
    vec2 upstream = clamp(vUv - flow * uDelta, cellMin, cellMax);
    vec4 above = texture2D(uMask, upstream);
    height = max(height, above.r * 0.985 * step(0.30, above.b));

    // Surface tension: a wet-only blur that rounds off the stamped edges.
    float neighbours =
      texture2D(uMask, clamp(vUv + vec2(uTexel.x, 0.0), cellMin, cellMax)).r +
      texture2D(uMask, clamp(vUv - vec2(uTexel.x, 0.0), cellMin, cellMax)).r +
      texture2D(uMask, clamp(vUv + vec2(0.0, uTexel.y), cellMin, cellMax)).r +
      texture2D(uMask, clamp(vUv - vec2(0.0, uTexel.y), cellMin, cellMax)).r;
    height = mix(height, max(height, neighbours * 0.25 * 1.02), wet * 0.4);

    gl_FragColor = vec4(
      height,
      max(0.0, fresh - uDelta * 6.5),
      max(0.0, wet - uDelta * 0.34),
      1.0
    );
  }
`

// Subsamples the mask down to a small target so coverage can be read back
// without stalling on a full-resolution readPixels.
export const reduceFragmentShader = `
  uniform sampler2D uMask;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    vec2 base = vUv - uStep * 4.0;
    float covered = 0.0;
    for (int y = 0; y < 8; y += 1) {
      for (int x = 0; x < 8; x += 1) {
        covered += step(0.5, texture2D(uMask, base + (vec2(float(x), float(y)) + 0.5) * uStep).r);
      }
    }
    gl_FragColor = vec4(covered / 64.0, 0.0, 0.0, 1.0);
  }
`

export const surfaceVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const surfaceFragmentShader = `
  uniform sampler2D paintMask;
  uniform vec2 uMaskSize;
  uniform vec2 uGrid;
  uniform vec3 baseColor;
  uniform vec3 inkColor;
  uniform vec3 uLightDirection;
  uniform float uBulge;
  uniform float uSpecular;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  // A custom ShaderMaterial is handed the fog uniforms but none of three's
  // shader chunks, so the declarations have to be written out by hand.
  #ifdef USE_FOG
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
  #endif

  void main() {
    vec3 geometryNormal = normalize(vNormal);

    // Mikkelsen cotangent frame: a tangent basis from screen-space derivatives,
    // so ink can bend the normal and be raymarched without the geometry needing
    // tangent attributes.
    vec3 dPositionX = dFdx(vWorldPosition);
    vec3 dPositionY = dFdy(vWorldPosition);
    vec2 dUvX = dFdx(vUv);
    vec2 dUvY = dFdy(vUv);
    vec3 perpY = cross(dPositionY, geometryNormal);
    vec3 perpX = cross(geometryNormal, dPositionX);
    vec3 tangent = perpY * dUvX.x + perpX * dUvY.x;
    vec3 bitangent = perpY * dUvX.y + perpX * dUvY.y;
    float frameScale = inversesqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
    tangent *= frameScale;
    bitangent *= frameScale;

    vec3 view = normalize(cameraPosition - vWorldPosition);
    // The uniform is a world-space position, not a unit vector.
    vec3 light = normalize(uLightDirection);

    // Atlas cells share one texture, so every sample below has to stay inside
    // this face's cell or ink bleeds in from a neighbouring face.
    vec2 cellIndex = floor(vUv * uGrid);
    vec2 cellMin = cellIndex / uGrid;
    vec2 cellMax = (cellIndex + 1.0) / uGrid;

    vec4 mask = texture2D(paintMask, vUv);
    float height = mask.r;
    float fresh = mask.g;
    float wet = mask.b;

    // Fresh ink starts with a raised threshold and relaxes to 0.5, which reads
    // as the splat expanding into place over ~150ms.
    float threshold = 0.5 * (1.0 + fresh * 0.55);
    float softness = fwidth(height) * 0.8 + 0.012;
    float ink = smoothstep(threshold - softness, threshold + softness, height);

    vec2 texel = 1.0 / uMaskSize;
    float left = texture2D(paintMask, clamp(vUv - vec2(texel.x, 0.0), cellMin, cellMax)).r;
    float right = texture2D(paintMask, clamp(vUv + vec2(texel.x, 0.0), cellMin, cellMax)).r;
    float down = texture2D(paintMask, clamp(vUv - vec2(0.0, texel.y), cellMin, cellMax)).r;
    float up = texture2D(paintMask, clamp(vUv + vec2(0.0, texel.y), cellMin, cellMax)).r;
    vec2 slope = vec2(right - left, up - down);

    vec3 normal = normalize(geometryNormal - (tangent * slope.x + bitangent * slope.y) * uBulge * ink);

    float lambert = max(0.0, dot(normal, light));
    vec3 surface = baseColor * (0.52 + 0.48 * max(0.0, dot(geometryNormal, light)));


    // Ink stays close to flat and saturated; the shape comes from specular and
    // from the raymarch, not from diffuse shading.
    vec3 paint = inkColor * (0.84 + 0.26 * lambert);
    vec3 color = mix(surface, paint, ink);

    // Meniscus: a darker band just inside the boundary sells the ink as a
    // pooled layer with thickness rather than a flat sticker.
    float rim = ink * (1.0 - smoothstep(threshold + softness, threshold + softness + 0.18, height));
    color = mix(color, inkColor * 0.42, rim * 0.6);

    vec3 halfway = normalize(light + view);
    float gloss = mix(30.0, 160.0, wet);
    float specular = pow(max(0.0, dot(normal, halfway)), gloss) * mix(0.22, 1.15, wet) * ink * uSpecular;
    // Broad sky reflection: the wide low-frequency lobe that makes it look wet.
    float sheen = pow(max(0.0, dot(normal, normalize(view + vec3(0.0, 1.0, 0.0)))), 6.0) * ink * wet * 0.16;
    color += specular + sheen;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #ifdef USE_FOG
      float fogDepth = length(vWorldPosition - cameraPosition);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, fogDepth));
    #endif
  }
`

// One billboarded quad per live shot, shaded as a sphere. Position, velocity
// and radius are written straight from the CPU projectile each frame rather
// than re-integrated here, so the ball disappears on exactly the frame the
// splat lands instead of sailing on through the surface.
export const projectileVertexShader = `
  attribute vec3 aPosition;
  attribute vec3 aVelocity;
  attribute float aRadius;
  uniform vec3 uLightDirection;
  varying vec2 vUv;
  varying vec3 vViewLight;
  void main() {
    vec4 viewPosition = viewMatrix * vec4(aPosition, 1.0);
    vec3 viewVelocity = (viewMatrix * vec4(aVelocity, 0.0)).xyz;

    // Just enough elongation to read as motion; a ball of paint should still
    // look like a ball, not a ribbon.
    vec2 along = normalize(viewVelocity.xy + vec2(1e-5));
    vec2 across = vec2(-along.y, along.x);
    float stretch = 1.0 + min(0.55, length(viewVelocity) * 0.011);
    viewPosition.xy += (along * position.x * stretch + across * position.y) * aRadius * 2.0;

    vViewLight = normalize((viewMatrix * vec4(uLightDirection, 0.0)).xyz);
    vUv = uv;
    gl_Position = projectionMatrix * viewPosition;
  }
`

export const projectileFragmentShader = `
  uniform vec3 uInkColor;
  varying vec2 vUv;
  varying vec3 vViewLight;
  void main() {
    // Reconstruct a hemisphere normal across the quad so the flat billboard
    // shades as a solid ball.
    vec2 offset = (vUv - 0.5) * 2.0;
    float radial = dot(offset, offset);
    if (radial > 1.0) discard;
    vec3 normal = vec3(offset, sqrt(1.0 - radial));

    float lambert = max(0.0, dot(normal, vViewLight));
    vec3 color = uInkColor * (0.70 + 0.42 * lambert);

    vec3 view = vec3(0.0, 0.0, 1.0);
    vec3 halfway = normalize(vViewLight + view);
    color += pow(max(0.0, dot(normal, halfway)), 42.0) * 0.85;

    // Darker toward the silhouette, which is what sells the volume.
    color *= mix(1.0, 0.68, smoothstep(0.5, 1.0, radial));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
