/** Tuning constants for DEAD GROUND. Units are meters and seconds. */

export const FIELD = {
  /** Samples per side. */
  N: 241,
  /** Sample spacing (m). The map is (N-1)*spacing = 480 m wide. */
  spacing: 2,
  half: 240,
  /** Orienteering maps use a 5 m contour interval with index contours every 25 m. */
  interval: 5,
  indexEvery: 5,
} as const;

export const PLAYER = {
  jog: 3.8,
  sprint: 5.6,
  crouch: 1.4,
  eyeStand: 1.7,
  eyeCrouch: 0.6,
  /** Slopes steeper than this (rise/run) cannot be climbed. */
  maxSlope: 1.25,
  turnRate: 10,
  accel: 8,
  punchRadius: 4,
  edge: 236,
} as const;

export const WATCH = {
  towerHeight: 9,
  towerRange: 150,
  towerHalfAngle: (25 * Math.PI) / 180,
  patrolEye: 1.7,
  patrolRange: 70,
  patrolHalfAngle: (35 * Math.PI) / 180,
  patrolSpeed: 1.5,
  /** Alert per second when seen at point-blank range; falls off to 40% at max range. */
  alertRate: 1.1,
  alertDecay: 0.3,
  /** Sprinting this close to a watcher is heard even out of sight. */
  hearRadius: 35,
  hearRate: 0.25,
  caughtPenalty: 30,
  /** Seconds after (re)starting during which the alert gauge cannot rise. */
  respawnGrace: 2,
  /** Length of the caught screen before the respawn (s). */
  caughtScreen: 2.6,
  losStep: 1.5,
  maxWatchers: 6,
} as const;
