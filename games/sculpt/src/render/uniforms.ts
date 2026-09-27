import { Color, DataTexture, FloatType, NearestFilter, RGFormat, Vector2 } from 'three';
import { FIELD } from '../config';

const N = FIELD.N;

/** Control heights (R) and bedrock (G), uploaded whenever the field changes. */
export const fieldData = new Float32Array(N * N * 2);
export const fieldTexture = new DataTexture(fieldData, N, N, RGFormat, FloatType);
fieldTexture.magFilter = NearestFilter;
fieldTexture.minFilter = NearestFilter;
fieldTexture.needsUpdate = true;

/** Uniform objects shared by every material, so one write updates all of them. */
export const shared = {
  uField: { value: fieldTexture },
  uBg: { value: new Color(0x0b0b0b) },
  uInk: { value: new Color(0xecebe6) },
  uBallH: { value: 0 },
  uBallLine: { value: 0 },
  uWater: { value: -1000 },
  uRevealCenter: { value: new Vector2() },
  uReveal: { value: 1e4 },
  uTime: { value: 0 },
};
