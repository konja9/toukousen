import { Color, DataTexture, FloatType, LinearFilter, NearestFilter, RedFormat, UnsignedByteType, Vector3 } from 'three';
import { ECHO, FIELD } from '../config';

const N = FIELD.N;
const EN = ECHO.N;

export const fieldData = new Float32Array(N * N);
export const fieldTexture = new DataTexture(fieldData, N, N, RedFormat, FloatType);
fieldTexture.magFilter = NearestFilter;
fieldTexture.minFilter = NearestFilter;

function floatGrid(): DataTexture {
  const t = new DataTexture(new Float32Array(EN * EN).fill(-1e9), EN, EN, RedFormat, FloatType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Times the latest own / enemy wavefront reached each echo cell. */
export const echoOwnTexture = floatGrid();
export const echoEnemyTexture = floatGrid();
/** Charted cells (0/255), linearly filtered for soft edges. */
export const chartTexture = new DataTexture(new Uint8Array(EN * EN), EN, EN, RedFormat, UnsignedByteType);
chartTexture.magFilter = LinearFilter;
chartTexture.minFilter = LinearFilter;
chartTexture.unpackAlignment = 1;
chartTexture.needsUpdate = true;

/** Point the echo textures at a world's arrays (they are uploaded, not copied). */
export function bindEcho(own: Float32Array, enemy: Float32Array, charted: Uint8Array): void {
  echoOwnTexture.image.data = own;
  echoEnemyTexture.image.data = enemy;
  chartTexture.image.data = charted;
  echoOwnTexture.needsUpdate = true;
  echoEnemyTexture.needsUpdate = true;
  chartTexture.needsUpdate = true;
}

/** Shared uniform objects: writing `.value` updates every material using them. */
export const shared = {
  uField: { value: fieldTexture },
  uEchoOwn: { value: echoOwnTexture },
  uEchoEnemy: { value: echoEnemyTexture },
  uChart: { value: chartTexture },
  uBg: { value: new Color(0x060708) },
  uInk: { value: new Color(0xe9ecea) },
  /** World clock (the times in the echo textures are on this clock). */
  uNow: { value: 0 },
  uFade: { value: 6 },
  uSub: { value: new Vector3(0, -100, 0) },
  uLayer: { value: -100 },
  uProx: { value: 26 },
  uFogDist: { value: 230 },
  uTime: { value: 0 },
  /** 0..1: charted memory brightness (the title screen shows none). */
  uMemory: { value: 1 },
};
