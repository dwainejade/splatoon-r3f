# Ink Rush R3F

An original first-person, single-player paint time-attack game built with React Three Fiber. The goal for the ink itself is a thick, glossy, liquid read — splats that merge into one body of paint, catch a moving highlight, and run downhill on walls. The game around it is its own thing, not a clone of any existing title.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Click **Start 3-minute run**, then click the arena to capture the pointer. Move with **WASD**, hold the left mouse button to spray, and hold/release the right mouse button for a charged burst.

## Tuning the game

Every tunable lives in [`src/settings.js`](src/settings.js). Change a number, save, and Vite hot-reloads it — no other file should need editing to rebalance the game.

| Group | Controls |
| --- | --- |
| `RUN` | match length |
| `PLAYER` | move speed, eye height, field of view, spawn, how far you may walk |
| `INK` | tank capacity and refill rate |
| `WEAPONS` | per-tool speed, gravity, spread, fire rate, ink cost, splat radius, charge behaviour |
| `PAINT` | ink colour, gloss, edge wobble, how long ink stays wet, drip speed, shedding, mask resolution |
| `ARENA` | floor size, block layout, colours, lighting, fog |
| `SCORING` | how often coverage is sampled |

The most common edits:

- **Paint colour** — `PAINT.color`
- **Coverage radius where paint lands** — `WEAPONS.standard.radius` (0.68 paints a circle ~1.36m across), with `radiusPerMetre` for how much it widens over distance and `maxRadius` as the ceiling
- **Fire rate** — `WEAPONS.standard.fireInterval` (seconds between shots)
- **Range** — `WEAPONS.standard.muzzleSpeed` against `gravity`
- **Move speed** — `PLAYER.moveSpeed`

Two things are deliberately *not* in there because they are structural rather than tunable: mask channel layout, and the number of satellite droplets per splat (a GLSL loop bound, which must stay a compile-time constant).

## How the weapons work

Ink is a projectile, not a hitscan ray. Each shot leaves the muzzle at the tool's speed, falls under the tool's gravity, and every frame the segment it just travelled is swept against the world — so a fast shot cannot tunnel through a thin surface. Tools are pure data in the `WEAPONS` table; adding one is a table entry, not code.

Three numbers give a tool its character:

- **reach** — `muzzleSpeed` against `gravity`. High speed and low gravity draw a flat, long line; low speed and high gravity lob and die short. The standard tool settles around 14m fired level from eye height.
- **footprint** — `radius` plus `radiusPerMetre`. Ink disperses in flight, so a shot that travels further lands wider, up to `maxRadius`.
- **rate** — `fireInterval` against `inkCost`, which is what trades coverage speed against how long the trigger can be held.

The standard tool is continuous automatic fire: one sphere of ink per tick, about thirteen a second for as long as the trigger is held. Each ball is a billboarded quad shaded as a sphere, and its position, velocity and radius are written straight from the CPU projectile every frame rather than re-integrated on the GPU — so a ball disappears on exactly the frame its splat lands instead of sailing on through the surface. Balls grow to full size over the first 1.6m of flight, since they spawn barely half a metre from the eye and would otherwise black out the screen on every shot.

Splat shape follows the impact, not just the tool. A head-on hit stamps a disc; the shallower the angle, the further the splat smears along the direction the ink was travelling, capped by `maxStretch`. The blob is always evaluated in a round unit disc and the quad is what gets deformed, so lobes and satellite droplets stretch with it.

## How the paint works

Every paintable surface owns a pair of RGBA8 render targets in its own UV space, ping-ponged each frame:

| Channel | Meaning |
| --- | --- |
| R | ink height — thresholded at 0.5 for coverage, its gradient drives the surface normal |
| G | fresh — decays over ~150ms, raises the threshold so a splat grows into place |
| B | wet — decays over ~3s, drives sheen, drip lifetime and surface tension |

**Painting happens in world space, not UV space.** This is the part that matters most.

Each surface bakes a **position map** once at load: the mesh is rasterised *unwrapped into its own UV space* (`gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0)`) and the fragment shader writes out the world position of every texel. A splat is then just a sphere in the world, and painting asks each texel "are you inside it?".

That is what lets ink wrap around an edge. Texels on both faces of a corner sit inside the same sphere and neither knows it belongs to a different face. The obvious approach — stamping a quad at the hit UV — cannot do this: a quad in UV space stops dead at the boundary of its face, which is exactly what produces a hard cut at every edge. It also means a splat is offered to *every* surface within reach, so ink thrown at a corner climbs the wall and covers the floor in one shot.

The position map is then **dilated** two texels outward, so UV seams and the padding around each atlas face still carry a world position. Without that the last texels along every face border have nothing to paint and render as an unpainted outline.

Stamps are `MAX`-blended, so overlapping splats merge into a single body of ink instead of compounding into a brighter blob at every intersection. The lobed outline is driven by the 3D direction out of the splat centre, so it stays continuous as it bends over an edge.

Credit for the approach: [vfxmike's Splatoon in Unity](https://vfxmike.blogspot.com/2017/04/splatoon-in-unity.html).

**Flow.** While any ink on a surface is still wet, a full-screen pass advects height downhill along a per-face direction, applies a wetness-gated blur for surface tension, and decays the two timer channels. Horizontal faces get a zero flow vector, so ink pools on floors and runs on walls without a special case.

**Shedding.** A run that reaches the bottom lip of a face does not stop at the edge of its mask — it falls off. Each mask is its own render target with no shared UV topology, so ink cannot be handed across in texture space; instead the surface works out at stamp time whether that splat's run will reach a cell bound before it dries, and hands the crossing point and its arrival time to the drip system. The drop then falls under its own gravity and paints whatever is beneath it, which is what carries paint from a wall onto the floor, or off one block onto another, without the two masks knowing anything about each other. Because a landed drop paints a splat smaller than `shedSplatRadius * 1.2`, drops cannot shed further drops and the chain terminates.

The crossing point is measured against the UV rectangle each face actually occupies, which is **not** its cell rectangle — `createAtlasBoxGeometry` insets faces inside their cell to stop bilinear filtering bleeding ink between neighbours, so walking to the raw cell bound overshoots past the real edge of the face.

**Shading.** The surface shader thresholds height with `fwidth` for a resolution-independent edge, perturbs the normal from the height gradient via a cotangent frame, and adds a darker meniscus band just inside the boundary. The liquid read comes mostly from a Blinn–Phong specular that tracks the real camera, sharpened and brightened by wetness.

**UV atlas.** Boxes are rebuilt with each face packed into its own cell of a 3×2 atlas. Without this a single mask would paint all six faces at once, and there would be no per-face direction for drips to follow.

**Scoring.** A reduce pass subsamples each mask to 64×64 on the GPU; only that 16 KB is read back, throttled to ~6 Hz.

Custom `ShaderMaterial`s do not receive three's fog, tone-mapping or colour-space chunks. The surface and droplet shaders call them explicitly — without that they write linear values to an sRGB framebuffer and the arena renders near-black.

## Implementation checklist

### Foundation

- [x] Vite, React, and React Three Fiber scaffold
- [x] First-person pointer-lock camera and WASD movement
- [x] Simple test arena, timer, ink meter, and run start screen
- [x] Wall-clock run timer and an end-of-run score screen
- [ ] Add collision-aware character movement and jumping

### Paint and scoring

- [x] Per-face UV atlas so each box face owns its own region of the mask
- [x] Mask resolution scaled from world size instead of a fixed 256px
- [x] Raycast weapon impacts and convert hit UVs to paint stamps
- [x] Height-field masks blended into world materials
- [x] Coverage via a GPU reduce pass and a small throttled readback
- [x] Connect coverage to the HUD and the end-of-run screen
- [ ] Author paintable meshes with dedicated secondary UVs rather than repacking at load

### Ink feel

- [x] Ballistic ink with per-tool speed, gravity, spread, reach and cadence
- [x] Splat size from distance flown, and smear from impact angle
- [x] Continuous automatic fire, one instanced sphere of ink per shot
- [x] Add a charged burst
- [ ] Add a second and third tool (roller, charger) and a way to switch between them
- [x] Procedural lobed splats with satellite droplets, max-blended so they merge
- [x] Wetness-driven sheen, gradient-perturbed normals, and a meniscus edge
- [x] Paint in world space off a position map, so ink wraps around edges and corners
- [ ] Depth: ink still reads flat. Parallax raymarching was tried and rejected — it floated and swam at grazing angles
- [x] Surface flow and drips on vertical faces for recently painted areas
- [x] Let drips cross from one surface onto another instead of stopping at the face edge
- [ ] Shed from the underside of an overhang, where there is no downhill to run along first
- [ ] Add audio, haptics where available, and hit feedback

### Gameplay and content

- [ ] Rebalance surface weights — the floor is ~83% of the total, so ground-sweeping dominates the score
- [ ] Build a complete 3-minute arena with vertical routes
- [ ] Add high-value zones and route-choice objectives
- [ ] Add score tiers, replay feedback, and local best score
- [ ] Build a second arena only after the first run is fun

### Performance and quality

- [ ] Pool render targets across surfaces instead of two per surface for the whole run
- [ ] Move the coverage readback to an async PBO so it never stalls the pipeline
- [ ] Add culling and resolution scaling for paintable tiles
- [ ] Profile on a mid-range laptop and hold 60 FPS
- [ ] Test pointer lock, keyboard controls, and reduced-motion options
