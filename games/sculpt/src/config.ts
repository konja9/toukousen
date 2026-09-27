/** Tuning constants for SCULPT. */

export const FIELD = {
  /** Samples per side; spacing is 1 m, so the model is (N-1) m wide. */
  N: 81,
  half: 40,
  minH: 0,
  maxH: 40,
  /** Bottom of the model's side walls. */
  base: -3,
  interval: 1,
  indexEvery: 5,
} as const;

export const BRUSH = {
  radiusMin: 3,
  radiusMax: 14,
  radiusDefault: 7,
  /** Peak raise/cut speed at the brush center (m/s). */
  rate: 2.6,
  undoDepth: 50,
} as const;

export const BALL = {
  gravity: 9.81,
  /** Solid sphere rolling without slipping. */
  rollFactor: 5 / 7,
  friction: 0.022,
  damping: 0.015,
  stopSpeed: 0.08,
  stillTime: 0.9,
  maxTime: 40,
  radius: 0.9,
  holeRadius: 2.0,
  /** A slow ball resting this close to the hole also counts. */
  holeRestRadius: 2.8,
  captureSpeed: 7,
  checkpointRadius: 2.4,
  stepHz: 120,
  previewSeconds: 4,
} as const;
