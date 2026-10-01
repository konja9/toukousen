import { TERRAIN as T, WIND as W } from '../config';
import noise from './shaders/noise.glsl?raw';
import height from './shaders/height.glsl?raw';
import contour from './shaders/contour.glsl?raw';

/** Format a number as a GLSL float literal. */
const f = (n: number) => {
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

const defines: Record<string, number> = {
  T_INTERVAL: T.interval,
  T_INDEX: T.indexEvery,
  T_SUB: T.subInterval,
  T_HATCH: T.hatch,
  T_SCALE: T.scale,
  T_BASE: T.base,
  T_HILL_AMP: T.hillAmp,
  T_HILL_FREQ: T.hillFreq,
  T_MASK_FREQ: T.maskFreq,
  T_RIDGE_FREQ: T.ridgeFreq,
  T_MOUNT_AMP0: T.mountAmp0,
  T_MOUNT_AMP1: T.mountAmp1,
  T_DIFF_DIST: T.difficultyDist,
  T_VALLEY_AMP: T.valleyAmp,
  T_VALLEY_WAVE: T.valleyWave,
  T_VALLEY_NOISE_AMP: T.valleyNoiseAmp,
  T_VALLEY_NOISE_WAVE: T.valleyNoiseWave,
  T_HALFW0: T.halfWidth0,
  T_HALFW1: T.halfWidth1,
  T_FLOOR_BASE: T.floorBase,
  T_FLOOR_AMP: T.floorAmp,
  T_FLOOR_WAVE: T.floorWave,
  T_DETAIL_AMP: T.detailAmp,
  T_DETAIL_WAVE: T.detailWave,
};

const DEFINES = Object.entries(defines)
  .map(([k, v]) => `#define ${k} ${f(v)}`)
  .join('\n');

/** `float terrainHeight(vec2 xz)` plus its dependencies. Requires `uniform vec2 uSeed` (declared inside). */
export const HEIGHT_GLSL = `${DEFINES}\n${noise}\n${height}`;

/** `contourInk()`, `applyReveal()` and the shared palette uniforms. */
export const CONTOUR_GLSL = contour;

/**
 * `float ridgeLift(vec3 p, vec2 wind)`: the vertical air speed of the ridge
 * lift at p, the GPU twin of `ridgeLift()` in wind.ts. Requires HEIGHT_GLSL.
 */
export const WIND_GLSL = /* glsl */ `
float ridgeLift(vec3 p, vec2 wind) {
  float U = length(wind);
  if (U < 1e-3) return 0.0;
  vec2 d = wind / U;
  const float e = ${f(W.slopeStep)};
  float gx = (terrainHeight(p.xz + vec2(e, 0.0)) - terrainHeight(p.xz - vec2(e, 0.0))) / (2.0 * e);
  float gz = (terrainHeight(p.xz + vec2(0.0, e)) - terrainHeight(p.xz - vec2(0.0, e))) / (2.0 * e);
  float s = clamp(gx * d.x + gz * d.y, -${f(W.maxSlope)}, ${f(W.maxSlope)});
  float agl = max(0.0, p.y - terrainHeight(p.xz));
  float fade = exp(-agl / ${f(W.decay)});
  return (s > 0.0 ? ${f(W.liftGain)} : ${f(W.sinkGain)}) * U * s * fade;
}
`;
