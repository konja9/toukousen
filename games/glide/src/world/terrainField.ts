import { TERRAIN as T } from '../config';
import { snoise } from './noise';

/**
 * CPU mirror of shaders/height.glsl. Any change here must be reflected in the
 * shader (and vice versa); `?selftest` compares the two on the GPU.
 */

export type SeedVec = readonly [number, number];

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Derive a noise-space offset from a sheet number. Rounded to float32 because it is uploaded as a uniform. */
export function seedVector(sheet: number): SeedVec {
  const h1 = Math.sin(sheet * 12.9898 + 1.7) * 43758.5453;
  const h2 = Math.sin(sheet * 78.233 + 4.1) * 24634.6345;
  return [Math.fround((h1 - Math.floor(h1)) * 60), Math.fround((h2 - Math.floor(h2)) * 60)];
}

export class TerrainField {
  readonly seed: SeedVec;

  constructor(seed: SeedVec) {
    this.seed = seed;
  }

  difficulty(z: number): number {
    return smoothstep(0, T.difficultyDist, -z);
  }

  valleyCenter(z: number): number {
    const [sx, sy] = this.seed;
    return (
      T.valleyAmp * Math.sin(z / T.valleyWave + sx * 6) +
      T.valleyNoiseAmp * snoise(z / T.valleyNoiseWave, 7.1 + sy)
    );
  }

  /** dx/dz of the valley centerline (numerical). */
  valleySlope(z: number): number {
    const e = 2;
    return (this.valleyCenter(z + e) - this.valleyCenter(z - e)) / (2 * e);
  }

  /** Heading (yaw) that follows the valley when flying towards -z. */
  valleyHeading(z: number): number {
    return Math.atan2(-this.valleySlope(z), 1);
  }

  heightAt(x: number, z: number): number {
    const [sx, sy] = this.seed;
    const k = this.difficulty(z);
    const px = x / T.scale + sx;
    const pz = z / T.scale + sy;

    const hills = fbm(px * T.hillFreq, pz * T.hillFreq);
    const mask = smoothstep(-0.35, 0.55, snoise(px * T.maskFreq + 31.7, pz * T.maskFreq - 12.3));
    const ridge = ridged(px * T.ridgeFreq - 5.1, pz * T.ridgeFreq + 7.7);
    const amp = mix(T.mountAmp0, T.mountAmp1, k);
    const h = T.base + hills * T.hillAmp + ridge * (0.25 + 0.75 * mask) * amp;

    const cx = this.valleyCenter(z);
    const halfW = mix(T.halfWidth0, T.halfWidth1, k);
    const dx = Math.abs(x - cx);
    const floorH =
      T.floorBase +
      T.floorAmp * (1 + k) * snoise(z / T.floorWave + sx, 3.3 + sy) +
      T.detailAmp * snoise(x / T.detailWave + sx * 3, z / T.detailWave + sy * 3);
    const t = smoothstep(halfW * 0.3, halfW * 2.0, dx);
    return mix(floorH + dx * 0.12, h, t);
  }
}

function fbm(x: number, y: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 5; i++) {
    s += a * snoise(x, y);
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.03 + 1.7;
    y = ry * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}

function ridged(x: number, y: number): number {
  let s = 0;
  let a = 0.5;
  let w = 1;
  for (let i = 0; i < 4; i++) {
    let n = 1 - Math.abs(snoise(x, y));
    n *= n;
    n *= w;
    w = clamp(n * 1.6, 0, 1);
    s += a * n;
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.11 - 3.3;
    y = ry * 2.11 + 4.9;
    a *= 0.5;
  }
  return s;
}
