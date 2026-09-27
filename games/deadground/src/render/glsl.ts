import { FIELD, WATCH } from '../config';
import bspline from './shaders/bspline.glsl?raw';
import contour from './shaders/contour.glsl?raw';

const f = (n: number) => (/[.e]/.test(String(n)) ? String(n) : `${n}.0`);

const DEFINES = [
  `#define F_N ${FIELD.N}`,
  `#define F_HALF ${f(FIELD.half)}`,
  `#define F_SPACING ${f(FIELD.spacing)}`,
  `#define F_INTERVAL ${f(FIELD.interval)}`,
  `#define F_INDEX ${f(FIELD.indexEvery)}`,
  `#define W_MAX ${WATCH.maxWatchers}`,
].join('\n');

/** `float fieldAt(vec2 xz)`; declares `uniform sampler2D uField`. */
export const FIELD_GLSL = `${DEFINES}\n${bspline}`;
/** Contours, viewshed test and reveal wipe. */
export const CONTOUR_GLSL = contour;
