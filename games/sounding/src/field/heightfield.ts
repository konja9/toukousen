import { FIELD } from '../config';

/**
 * Terrain as an N x N grid of control heights smoothed by a uniform cubic
 * B-spline (the same surface is evaluated in shaders/bspline.glsl), so the
 * ground, line-of-sight checks and the drawn contours all agree.
 */

const N = FIELD.N;
const S = FIELD.spacing;
const H = FIELD.half;

function basis(t: number, w: Float64Array, d: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  const it = 1 - t;
  w[0] = (it * it * it) / 6;
  w[1] = (3 * t3 - 6 * t2 + 4) / 6;
  w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  w[3] = t3 / 6;
  d[0] = -(it * it) / 2;
  d[1] = (3 * t2 - 4 * t) / 2;
  d[2] = (-3 * t2 + 2 * t + 1) / 2;
  d[3] = t2 / 2;
}

const wx = new Float64Array(4);
const wz = new Float64Array(4);
const dx = new Float64Array(4);
const dz = new Float64Array(4);

export interface Sample {
  h: number;
  gx: number;
  gz: number;
}

export class HeightField {
  /** Control heights, row-major: index = j * N + i, x = i*S - H, z = j*S - H. */
  readonly h = new Float32Array(N * N);

  static readonly N = N;

  fill(fn: (x: number, z: number) => number): void {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.h[j * N + i] = fn(i * S - H, j * S - H);
  }

  private at(i: number, j: number): number {
    i = i < 0 ? 0 : i > N - 1 ? N - 1 : i;
    j = j < 0 ? 0 : j > N - 1 ? N - 1 : j;
    return this.h[j * N + i];
  }

  sample(x: number, z: number, out: Sample = { h: 0, gx: 0, gz: 0 }): Sample {
    const u = (x + H) / S;
    const v = (z + H) / S;
    const i = Math.floor(u);
    const j = Math.floor(v);
    basis(u - i, wx, dx);
    basis(v - j, wz, dz);
    let h = 0;
    let gx = 0;
    let gz = 0;
    for (let b = 0; b < 4; b++) {
      for (let a = 0; a < 4; a++) {
        const c = this.at(i - 1 + a, j - 1 + b);
        h += wx[a] * wz[b] * c;
        gx += dx[a] * wz[b] * c;
        gz += wx[a] * dz[b] * c;
      }
    }
    out.h = h;
    out.gx = gx / S;
    out.gz = gz / S;
    return out;
  }

  heightAt(x: number, z: number): number {
    return this.sample(x, z).h;
  }

  get min(): number {
    let m = Infinity;
    for (const v of this.h) m = Math.min(m, v);
    return m;
  }

  get max(): number {
    let m = -Infinity;
    for (const v of this.h) m = Math.max(m, v);
    return m;
  }
}
