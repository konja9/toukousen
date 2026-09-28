import { ECHO, FIELD } from '../config';
import bspline from './shaders/bspline.glsl?raw';
import sea from './shaders/sea.glsl?raw';

const f = (n: number) => (/[.e]/.test(String(n)) ? String(n) : `${n}.0`);

const DEFINES = [
  `#define F_N ${FIELD.N}`,
  `#define F_HALF ${f(FIELD.half)}`,
  `#define F_SPACING ${f(FIELD.spacing)}`,
  `#define F_INTERVAL ${f(FIELD.interval)}`,
  `#define F_INDEX ${f(FIELD.indexEvery)}`,
  `#define E_N ${ECHO.N}`,
  `#define E_SPACING ${f(ECHO.spacing)}`,
].join('\n');

/** `float fieldAt(vec2 xz)`; declares `uniform sampler2D uField`. */
export const FIELD_GLSL = `${DEFINES}\n${bspline}`;
/** Isobaths, echo glow, chart mask. */
export const SEA_GLSL = sea;
