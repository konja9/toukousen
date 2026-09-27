import { BRUSH, FIELD } from '../config';

/**
 * Editable terrain: an N x N grid of control heights (1 m spacing) smoothed by a
 * uniform cubic B-spline, so the surface and its slope are continuous and the
 * contour lines stay smooth. shaders/bspline.glsl evaluates the same surface on the GPU.
 */

export type BrushMode = 'raise' | 'cut';

const N = FIELD.N;
const H = FIELD.half;

/** Cubic B-spline basis weights and derivatives for parameter t in [0, 1). */
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
  /** dh/dx, dh/dz */
  gx: number;
  gz: number;
  rock: number;
}

interface Snapshot {
  h: Float32Array;
  soil: number;
}

export class HeightField {
  /** Control heights, row-major: index = j * N + i, x = i - half, z = j - half. */
  readonly h = new Float32Array(N * N);
  /** 1 where the ground cannot be edited. */
  readonly rock = new Float32Array(N * N);
  soil = 0;
  /** Incremented on every change so views know when to re-upload. */
  version = 0;
  private undoStack: Snapshot[] = [];

  static readonly N = N;

  fill(fn: (x: number, z: number) => number, rockFn?: (x: number, z: number) => number): void {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i - H;
        const z = j - H;
        this.h[j * N + i] = clampH(fn(x, z));
        this.rock[j * N + i] = rockFn ? Math.min(Math.max(rockFn(x, z), 0), 1) : 0;
      }
    }
    this.undoStack = [];
    this.version++;
  }

  /** Copy heights and bedrock from another field (used for stable picking during a stroke). */
  copyFrom(other: HeightField): void {
    this.h.set(other.h);
    this.rock.set(other.rock);
    this.version++;
  }

  private at(i: number, j: number): number {
    i = i < 0 ? 0 : i > N - 1 ? N - 1 : i;
    j = j < 0 ? 0 : j > N - 1 ? N - 1 : j;
    return this.h[j * N + i];
  }

  private rockAt(i: number, j: number): number {
    i = i < 0 ? 0 : i > N - 1 ? N - 1 : i;
    j = j < 0 ? 0 : j > N - 1 ? N - 1 : j;
    return this.rock[j * N + i];
  }

  /** Surface height, slope and rock amount at world (x, z). */
  sample(x: number, z: number, out: Sample = { h: 0, gx: 0, gz: 0, rock: 0 }): Sample {
    const u = x + H;
    const v = z + H;
    const i = Math.floor(u);
    const j = Math.floor(v);
    basis(u - i, wx, dx);
    basis(v - j, wz, dz);
    let h = 0;
    let gx = 0;
    let gz = 0;
    let r = 0;
    for (let b = 0; b < 4; b++) {
      for (let a = 0; a < 4; a++) {
        const c = this.at(i - 1 + a, j - 1 + b);
        h += wx[a] * wz[b] * c;
        gx += dx[a] * wz[b] * c;
        gz += wx[a] * dz[b] * c;
        r += wx[a] * wz[b] * this.rockAt(i - 1 + a, j - 1 + b);
      }
    }
    out.h = h;
    out.gx = gx;
    out.gz = gz;
    out.rock = r;
    return out;
  }

  heightAt(x: number, z: number): number {
    return this.sample(x, z).h;
  }

  /** Save state before a stroke so it can be undone. */
  pushUndo(): void {
    this.undoStack.push({ h: this.h.slice(), soil: this.soil });
    if (this.undoStack.length > BRUSH.undoDepth) this.undoStack.shift();
  }

  /** Drop the last snapshot (a stroke that changed nothing). */
  discardUndo(): void {
    this.undoStack.pop();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.h.set(s.h);
    this.soil = s.soil;
    this.version++;
    return true;
  }

  /**
   * Raise or cut around (x, z). `amount` is the peak change in meters at the
   * center. Raising spends soil, cutting stores it (cut and fill balance).
   * Returns the volume moved (m^3).
   */
  brush(x: number, z: number, radius: number, amount: number, mode: BrushMode): number {
    const sigma = radius / 1.7;
    const reach = radius * 1.6;
    const i0 = Math.max(0, Math.floor(x + H - reach));
    const i1 = Math.min(N - 1, Math.ceil(x + H + reach));
    const j0 = Math.max(0, Math.floor(z + H - reach));
    const j1 = Math.min(N - 1, Math.ceil(z + H + reach));
    const idx: number[] = [];
    const dh: number[] = [];
    let total = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = i - H - x;
        const pz = j - H - z;
        const d2 = px * px + pz * pz;
        if (d2 > reach * reach) continue;
        const k = j * N + i;
        const w = Math.exp(-d2 / (2 * sigma * sigma)) * (1 - this.rock[k]);
        if (w < 1e-4) continue;
        let d = amount * w;
        if (mode === 'raise') d = Math.min(d, FIELD.maxH - this.h[k]);
        else d = Math.min(d, this.h[k] - FIELD.minH);
        if (d <= 0) continue;
        idx.push(k);
        dh.push(d);
        total += d;
      }
    }
    if (total <= 0) return 0;
    if (mode === 'raise') {
      const scale = Math.min(1, this.soil / total);
      if (scale <= 0) return 0;
      for (let n = 0; n < idx.length; n++) this.h[idx[n]] += dh[n] * scale;
      this.soil -= total * scale;
      this.version++;
      return total * scale;
    }
    for (let n = 0; n < idx.length; n++) this.h[idx[n]] -= dh[n];
    this.soil += total;
    this.version++;
    return total;
  }

  /** Sum of control heights (m^3 above the base). */
  volume(): number {
    let v = 0;
    for (let k = 0; k < this.h.length; k++) v += this.h[k];
    return v;
  }
}

function clampH(v: number): number {
  return v < FIELD.minH ? FIELD.minH : v > FIELD.maxH ? FIELD.maxH : v;
}
