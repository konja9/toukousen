/**
 * Tuning constants for SOUNDING. Units are meters and seconds.
 * The world is y-up with the sea surface at y = 0, so the seafloor has
 * negative heights and depth = -y.
 */

export const FIELD = {
  /** Samples per side. */
  N: 241,
  /** Sample spacing (m). A sector is (N-1)*spacing = 600 m wide. */
  spacing: 2.5,
  half: 300,
  /** Isobaths every 10 m, index lines every 50 m. */
  interval: 10,
  indexEvery: 5,
} as const;

export const SUB = {
  /** Speed for each throttle step: stop, slow, half, full (m/s). */
  speeds: [0, 2.2, 4.8, 8.5],
  /** How far the engine is heard at each step (m). */
  noise: [12, 45, 120, 260],
  /** Battery drain per second at each step (percent). */
  drain: [0.01, 0.04, 0.16, 0.55],
  turnRate: 0.55,
  climbRate: 3,
  accel: 0.9,
  radius: 3,
  /** The sub cannot come shallower than this. */
  minDepth: 15,
  edge: 292,
  hull: 100,
  battery: 100,
  /** Damage per m/s of speed into a wall. */
  impactDamage: 4.5,
} as const;

export const SONAR = {
  /** Wavefront speed (m/s) — slowed down from the real 1500 m/s so the wave can be watched. */
  speed: 150,
  range: 220,
  /** A ping is heard this far away (before the layer). */
  noise: 520,
  cost: 2.5,
  cooldown: 1.4,
  /** Directional ping: half angle, range and noise multipliers. */
  coneHalf: (25 * Math.PI) / 180,
  coneRange: 1.6,
  coneNoise: 0.5,
  /** Seconds a lit isobath takes to fade to about a third. */
  fade: 6,
} as const;

export const ECHO = {
  /** Echo grid spacing (m); (N-1)*spacing = 600 m. */
  spacing: 4,
  N: 151,
  losStep: 3,
} as const;

export const LAYER = {
  /** Sound crossing the thermocline carries this fraction of the distance. */
  attenuation: 0.5,
  /** A route counts as hidden where the floor is this far below the layer. */
  clearance: 14,
} as const;

export const CONTACT = {
  shipDepth: 4,
  buoyDepth: 30,
  shipSpeed: 3.2,
  huntSpeed: 6,
  subSpeed: 2.6,
  /** Seconds between pings while searching or hunting. */
  pingEvery: 5.5,
  pingRange: 300,
  pingSpeed: 150,
  /** Hearing multiplier for each kind (how well it listens). */
  ears: { ship: 1, buoy: 1.25, hunter: 1.1 } as Record<string, number>,
  /** Search this long without a detection, then go back to patrolling. */
  giveUp: 28,
  /** Error of the position estimate from hearing, as a fraction of distance. */
  hearError: 0.18,
  chargeSink: 12,
  chargeRadius: 24,
  chargeDamage: 48,
  /** Charges dropped per attack run, spread around the aim point. */
  chargeSpread: 14,
  attackCooldown: 9,
  torpedoSpeed: 13,
  torpedoRadius: 9,
  torpedoDamage: 55,
  mineRadius: 8,
  mineDamage: 60,
  maxContacts: 10,
} as const;

export const RUN = {
  /** Clearing a sector restores this much battery and hull. */
  clearBattery: 35,
  clearHull: 10,
  surveyBattery: 12,
  surveyRadius: 150,
  exitRadius: 26,
} as const;
