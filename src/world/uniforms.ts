import { Color, Vector2 } from 'three';

/**
 * Uniform objects shared by every contour material. Materials hold references
 * to these same objects, so writing `.value` updates all of them at once.
 */
export const shared = {
  uSeed: { value: new Vector2() },
  uBg: { value: new Color(0x0b0b0b) },
  uInk: { value: new Color(0xeeeeea) },
  uAlt: { value: 0 },
  uAltLine: { value: 0 },
  uRevealCenter: { value: new Vector2() },
  uReveal: { value: 1e6 },
  uInkGain: { value: 1 },
  uHatch: { value: 1 },
  uFogDist: { value: 1150 },
  uTime: { value: 0 },
};

export type SharedUniforms = typeof shared;
