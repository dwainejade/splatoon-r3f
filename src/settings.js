// ---------------------------------------------------------------------------
// Every tunable in the game lives here. Nothing in this file is structural —
// change a number, save, and the dev server hot-reloads it.
//
//   RUN      match length
//   PLAYER   movement, camera, spawn
//   INK      tank size and refill
//   WEAPONS  per-tool ballistics, footprint and cadence
//   PAINT    how ink looks and behaves once it lands
//   ARENA    layout, colours, lighting, fog
//   SCORING  how coverage is sampled
//
// Units are metres, seconds, and degrees unless noted.
// ---------------------------------------------------------------------------

export const RUN = {
  seconds: 180,
}

export const PLAYER = {
  moveSpeed: 7,          // m/s on the ground
  eyeHeight: 1.7,
  fieldOfView: 60,       // vertical, degrees
  spawn: [0, 1.7, 15],
  // How far from the centre the player may walk, in metres. Keep inside
  // ARENA.floorSize / 2 or you can walk off the edge of the floor.
  arenaLimit: 19,
}

export const INK = {
  capacity: 100,
  // Refill rate. Fire rate costs WEAPONS.standard.inkCost every fireInterval,
  // so at the defaults spraying drains roughly 20/s against this 16.7/s refill.
  rechargePerSecond: 16.7,
}

// ---------------------------------------------------------------------------
// Weapons
//
// Adding a tool is a table entry, not code. Three groups of numbers give a tool
// its character:
//
//   reach     — muzzleSpeed against gravity. High speed and low gravity draw a
//               flat, long line; low speed and high gravity lob and die short.
//   footprint — radius plus radiusPerMetre, capped by maxRadius.
//   rate      — fireInterval against inkCost, which trades coverage speed
//               against how long the trigger can be held.
//
// A roller would be roughly { muzzleSpeed: 12, gravity: 26, radius: 2.4,
// radiusPerMetre: 0.01, spread: 0.09, fireInterval: 0.05 }; a charger roughly
// { muzzleSpeed: 70, gravity: 3, radius: 0.5, spread: 0, fireInterval: 0.9 }.
// ---------------------------------------------------------------------------

export const WEAPONS = {
  standard: {
    name: 'Standard',

    // --- Ballistics. At these values a level shot from eye height reaches ~14m.
    muzzleSpeed: 60,       // m/s at the muzzle
    gravity: 30,           // m/s² pulling the shot down
    lifetime: 3.0,         // s before a shot that hits nothing despawns
    spread: 0.022,         // radians of random cone; 0 is pinpoint

    // --- Cadence and cost. Continuous automatic fire: one sphere of ink per
    // tick, ~13 a second for as long as the trigger is held.
    fireInterval: 0.15,   // s between shots
    inkCost: 1.5,          // ink per shot, against INK.capacity

    // --- Footprint on impact. This is the coverage radius where the paint
    // lands: 0.68 paints a circle ~1.36m across. Ink disperses in flight, so a
    // shot that travels further lands wider.
    radius: 0.48,
    radiusPerMetre: 0.18, // extra radius per metre flown
    maxRadius: 1.7,        // ceiling on the above
    // Grazing hits smear along the direction of travel instead of stamping a
    // circle. This caps how far a shallow impact may elongate. 1 disables it.
    maxStretch: 10.4,

    // --- The ball in flight.
    projectileRadiusScale: 0.25,  // ball radius relative to the splat it makes
    emergenceDistance: 1.6,       // m over which a fresh ball grows to full size

    // --- Charged burst, on hold-and-release of the right mouse button.
    chargeSpeedScale: 0.55,   // + this fraction of muzzleSpeed at full charge
    chargeRadiusScale: 1.15,  // + this fraction of radius at full charge
    chargeInkCost: 18,
    chargeSpread: 0.008,
  },
}

export const DEFAULT_WEAPON = WEAPONS.standard

// Shots in flight at once, shared by the simulation and the renderer. Full-rate
// fire with a 1.6s lifetime needs about 22; the rest is headroom.
export const PROJECTILE_CAPACITY = 48

// Airborne ink droplets at once — both drips shed from a lip and splashes
// thrown up on impact draw from this pool.
export const DROPLET_CAPACITY = 192

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

export const PAINT = {
  color: '#ffb73c',

  // --- Look
  // How strongly the ink's height gradient bends the surface normal. Higher
  // domes the paint; too high and splats read as balloons rather than liquid.
  bulge: 1.4,
  // Multiplier on the specular highlight, which is what makes it read as wet.
  specular: 1,
  // How far the splat outline wobbles with angle. 0 is a plain circle; past
  // ~0.4 splats start reading as starfish rather than poured blobs.
  lobeAmount: 0.26,

  // --- Behaviour
  wetSeconds: 3.2,       // how long fresh ink stays glossy, flows and drips
  dripSpeed: 0.22,       // m/s that wet ink runs downhill on vertical faces

  // --- Shedding. A run that reaches the bottom lip of a face falls off it and
  // lands on whatever is below, rather than stopping at the edge.
  // Fraction of wall hits that eventually shed a falling drop. 0 disables it.
  // Kept well under 1 so a sustained spray sheds a scatter, not a curtain.
  shedChance: 0.3,
  shedSplatRadius: 0.22, // m, footprint a landed drop paints
  shedFallSpeed: 0.35,   // m/s downward as the drop leaves the lip
  shedGravity: 9.8,
  shedLifetime: 4,       // s before a drop that hits nothing gives up


  // --- Mask resolution. Higher is crisper paint and more GPU memory; each
  // surface gets two masks at the size this implies, clamped to 256..1024.
  texelsPerMetre: 26,
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export const ARENA = {
  floorSize: 42,
  floorColor: '#3d4460',
  // Blocks alternate between these two.
  blockColors: ['#47577d', '#6f577e'],
  // [centreX, centreY, centreZ, width, height, depth] in metres. centreY is
  // half the height if you want a block sitting on the floor.
  blocks: [
    [-11, 1.5, -8, 4, 3, 2],
    [8, 2, -10, 3, 4, 3],
    [-7, 1, 7, 5, 2, 2],
    [10, 1, 8, 3, 2, 5],
    [0, 3, 0, 3, 6, 3],
    [-15, 2, 8, 2, 4, 2],
  ],

  // Direction of the sun, also used to place the sky and to light the ink.
  lightDirection: [10, 18, 8],
  ambientIntensity: 0.45,
  sunIntensity: 2.4,

  backgroundColor: '#161a2b',
  fogColor: '#161a2b',
  fogNear: 22,
  fogFar: 56,
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const SCORING = {
  // Seconds between coverage samples. Lower is a more responsive percentage and
  // more GPU readbacks.
  interval: 0.15,
}
