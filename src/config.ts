/**
 * Tuning constants shared by the CPU simulation and the GLSL shaders.
 * Terrain values are injected into GLSL as #defines (see world/glsl.ts),
 * so this file is the single source of truth for the height function.
 */

export const TERRAIN = {
  /** Contour interval in meters. */
  interval: 10,
  /** Every Nth contour is an index (thick) contour. */
  indexEvery: 5,
  /** Fine sub-contours shown close to the camera. */
  subInterval: 2,
  /** Spacing of the danger hatching in meters. */
  hatch: 7,

  scale: 1000,
  base: 70,
  hillAmp: 55,
  hillFreq: 1.3,
  maskFreq: 0.32,
  ridgeFreq: 1.7,
  mountAmp0: 210,
  mountAmp1: 430,
  /** Distance (m) over which difficulty ramps from 0 to 1. */
  difficultyDist: 24000,

  valleyAmp: 380,
  valleyWave: 1700,
  valleyNoiseAmp: 190,
  valleyNoiseWave: 1750,
  halfWidth0: 150,
  halfWidth1: 88,
  floorBase: 22,
  floorAmp: 16,
  floorWave: 900,
  detailAmp: 2.5,
  detailWave: 70,
} as const;

export const FLIGHT = {
  gravity: 9.81,
  startSpeed: 52,
  startAGL: 140,
  minSpeed: 16,
  maxSpeed: 125,
  stallSpeed: 21,
  stallRecover: 29,
  /** Glide polar: sink = sinkMin + sinkK * (v - sinkBestSpeed)^2 */
  sinkMin: 1.5,
  sinkBestSpeed: 40,
  sinkK: 0.0014,
  cruiseSpeed: 64,
  dragAboveCruise: 0.035,
  maxBank: 1.05,
  bankResponse: 4.5,
  pitchRate: 0.95,
  pitchReturn: 1.4,
  pitchMin: -0.62,
  pitchMax: 0.5,
  turnGain: 1.55,
  yawLimit: (75 * Math.PI) / 180,
  brakeSink: 3.5,
  brakeDrag: 7,
  crashClearance: 1.2,
  stepHz: 120,
} as const;

export const WORLD = {
  gateSpacing: 460,
  gateFirst: 320,
  gateRadius: 16,
  gateAGLMin: 22,
  gateAGLMax: 34,
  gateBoost: 6,
  thermalCell: 800,
  thermalFirst: 650,
  thermalRadius: 85,
  thermalLift: 15,
  thermalHeight: 620,
} as const;

export const SCORE = {
  /** [max AGL, multiplier] — first match wins. */
  lowTiers: [
    [8, 4],
    [16, 3],
    [30, 2],
  ] as ReadonlyArray<readonly [number, number]>,
  gateBase: 200,
} as const;
