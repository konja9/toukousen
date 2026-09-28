import { TERRAIN as T } from '../config';
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
