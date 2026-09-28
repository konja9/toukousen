import { FIELD } from '../config';
import { snoise } from '../core/noise';
import { HeightField } from './heightfield';

/**
 * Seafloor for a sector. Heights are y-up (negative, the surface is y = 0).
 * Noise gives broad relief and a web of sharp-bottomed canyons; the sector
 * layout then carves its own canyon (with sills that rise above the layer),
 * adds seamounts and sinks the exit trench.
 */

export interface Carve {
  /** Canyon centre line (x, z). */
  path: ReadonlyArray<readonly [number, number]>;
  width: number;
  /** Canyon floor height (y). */
  floor: number;
  /** Places along the canyon (t = 0..1 of its length) where the whole floor rises to `y` (sills). */
  sills: ReadonlyArray<{ t: number; y: number; len: number }>;
}

export interface SeafloorParams {
  seed: number;
  /** Thermocline height (y). */
  layerY: number;
  /** Height of the ground between canyons, relative to the layer. */
  shelf: number;
  relief: number;
  /** Amount of natural canyon network, 0..1. */
  canyons: number;
  seamounts: ReadonlyArray<{ x: number; z: number; r: number; top: number }>;
  carves: ReadonlyArray<Carve>;
  exit: { x: number; z: number; r: number; y: number };
  entry: { x: number; z: number; r: number; y: number };
}

/** Ridge tops never come shallower than this, so the sub can always pass over. */
export const CEILING = -30;

function seedOffset(seed: number): [number, number] {
  const a = Math.sin(seed * 12.9898 + 3.1) * 43758.5453;
  const b = Math.sin(seed * 78.233 + 1.7) * 24634.6345;
  return [(a - Math.floor(a)) * 90, (b - Math.floor(b)) * 90];
}

function fbm(x: number, y: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * snoise(x, y);
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.03 + 1.7;
    y = ry * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}

/** 0 on open ground, rising towards 1 along the thin lines where the noise crosses zero. */
function creases(x: number, y: number): number {
  let s = 0;
  let a = 0.6;
  let w = 1;
  for (let i = 0; i < 3; i++) {
    let n = 1 - Math.abs(snoise(x, y));
    n = n * n * n * w;
    w = Math.min(Math.max(n * 1.4, 0), 1);
    s += a * n;
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.2 - 3.3;
    y = ry * 2.2 + 4.9;
    a *= 0.45;
  }
  return s;
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
};

/** Distance from p to the polyline, and the parameter (0..1 along its length). */
export function distToPath(path: ReadonlyArray<readonly [number, number]>, x: number, z: number): [number, number] {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const L2 = vx * vx + vz * vz;
    const L = Math.sqrt(L2);
    const t = L2 > 0 ? Math.min(Math.max(((x - ax) * vx + (z - az) * vz) / L2, 0), 1) : 0;
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) {
      best = d;
      bestS = (acc + t * L) / Math.max(total, 1e-6);
    }
    acc += L;
  }
  return [best, bestS];
}

/** Noise relief and seamounts, before any canyon is carved. */
function baseHeight(p: SeafloorParams, ox: number, oz: number, x: number, z: number): number {
  const px = x / 230 + ox;
  const pz = z / 230 + oz;
  const broad = fbm(px, pz, 4) * 26 * p.relief;
  const cr = creases(px * 1.3 + 5, pz * 1.3 - 2);
  const canyonNet = -Math.pow(cr, 1.5) * 95 * p.canyons;
  const rough = fbm(x / 40 + ox * 3, z / 40 + oz * 3, 2) * 4;
  let y = p.layerY + p.shelf + broad + canyonNet + rough;
  for (const m of p.seamounts) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    const bump = Math.exp(-d * d * 1.6);
    y = Math.max(y, y + (m.top - y) * bump);
  }
  return y;
}

const N: number = FIELD.N;
const S = FIELD.spacing;
const H = FIELD.half;

/**
 * Lower the field along a canyon. Each segment only touches the samples in
 * its own bounding box, keeping the nearest distance and the distance along
 * the canyon for every sample.
 */
function carve(h: Float32Array, c: Carve, ox: number, oz: number): void {
  const R = c.width * 2.2;
  const dist = new Float32Array(N * N).fill(Infinity);
  const along = new Float32Array(N * N);
  const cum: number[] = [0];
  for (let i = 0; i + 1 < c.path.length; i++) cum.push(cum[i] + Math.hypot(c.path[i + 1][0] - c.path[i][0], c.path[i + 1][1] - c.path[i][1]));
  const total = Math.max(cum[cum.length - 1], 1e-6);
  let i0 = N;
  let i1 = -1;
  let j0 = N;
  let j1 = -1;
  for (let k = 0; k + 1 < c.path.length; k++) {
    const [ax, az] = c.path[k];
    const [bx, bz] = c.path[k + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const L2 = vx * vx + vz * vz;
    const L = Math.sqrt(L2);
    const ia = Math.max(0, Math.floor((Math.min(ax, bx) - R + H) / S));
    const ib = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + H) / S));
    const ja = Math.max(0, Math.floor((Math.min(az, bz) - R + H) / S));
    const jb = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + H) / S));
    i0 = Math.min(i0, ia);
    i1 = Math.max(i1, ib);
    j0 = Math.min(j0, ja);
    j1 = Math.max(j1, jb);
    for (let j = ja; j <= jb; j++) {
      const z = j * S - H;
      for (let i = ia; i <= ib; i++) {
        const x = i * S - H;
        const t = L2 > 0 ? Math.min(Math.max(((x - ax) * vx + (z - az) * vz) / L2, 0), 1) : 0;
        const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        const n = j * N + i;
        if (d < dist[n]) {
          dist[n] = d;
          along[n] = cum[k] + t * L;
        }
      }
    }
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const n = j * N + i;
      const d = dist[n];
      if (d > R) continue;
      // U-shaped canyon: flat-ish floor, steep walls
      const k = d / c.width;
      const profile = Math.exp(-Math.pow(k, 4) * 0.9);
      const s = along[n];
      let floor = c.floor + fbm((s / total) * 9 + ox, 3.1 + oz, 2) * 5;
      for (const sill of c.sills) {
        const w = Math.exp(-Math.pow((s - sill.t * total) / sill.len, 2));
        floor = floor + (sill.y - floor) * w;
      }
      const y = h[n];
      h[n] = y + (Math.min(floor, y) - y) * profile;
    }
  }
}

export function generate(p: SeafloorParams): HeightField {
  const [ox, oz] = seedOffset(p.seed);
  const f = new HeightField();
  f.fill((x, z) => baseHeight(p, ox, oz, x, z));
  for (const c of p.carves) carve(f.h, c, ox, oz);
  for (let j = 0; j < N; j++) {
    const z = j * S - H;
    for (let i = 0; i < N; i++) {
      const x = i * S - H;
      let y = f.h[j * N + i];
      const pit = (q: { x: number; z: number; r: number; y: number }, sharp: number) => {
        const d = Math.hypot(x - q.x, z - q.z) / q.r;
        if (d > 3) return;
        const w = Math.exp(-Math.pow(d, sharp));
        y = y + (Math.min(q.y, y) - y) * w;
      };
      pit(p.entry, 2);
      pit(p.exit, 3);
      // keep ridge tops below the ceiling (soft) and the sheet edge a little deeper
      y = smin(y, CEILING, 8);
      const edge = Math.max(Math.abs(x), Math.abs(z)) - (H - 20);
      if (edge > 0) y -= edge * 0.4;
      f.h[j * N + i] = y;
    }
  }
  return f;
}
