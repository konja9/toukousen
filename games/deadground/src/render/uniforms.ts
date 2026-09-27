import { Color, DataTexture, FloatType, Matrix4, NearestFilter, RedFormat, Vector2, Vector3 } from 'three';
import { FIELD, WATCH } from '../config';

const N = FIELD.N;

export const fieldData = new Float32Array(N * N);
export const fieldTexture = new DataTexture(fieldData, N, N, RedFormat, FloatType);
fieldTexture.magFilter = NearestFilter;
fieldTexture.minFilter = NearestFilter;

const W = WATCH.maxWatchers;

/** Shared uniform objects: writing `.value` updates every material using them. */
export const shared = {
  uField: { value: fieldTexture },
  uBg: { value: new Color(0x0b0b0b) },
  uInk: { value: new Color(0xecebe6) },
  uReveal: { value: 1e5 },
  uRevealCenter: { value: new Vector2() },
  uTime: { value: 0 },
  uFogDist: { value: 230 },
  uVAtlas: { value: null as unknown },
  uVCount: { value: 0 },
  uVEye: { value: Array.from({ length: W }, () => new Vector3()) },
  uVDir: { value: Array.from({ length: W }, () => new Vector2(0, -1)) },
  uVCos: { value: new Array<number>(W).fill(1) },
  uVRange: { value: new Array<number>(W).fill(0) },
  uVMat: { value: Array.from({ length: W }, () => new Matrix4()) },
};
