import { ECHO, FIELD, LAYER } from '../config';
import type { HeightField } from './heightfield';

/**
 * Route search on the echo grid (4 m cells). Ground whose floor lies well
 * below the thermocline is "hidden": a sub can run there under the layer.
 * Everywhere else it has to rise above the layer to pass, which costs extra,
 * so the best route shows how much exposed water a sector forces on you.
 */

export const GN = ECHO.N;
export const GS = ECHO.spacing;
const H = FIELD.half;
export const toW = (i: number) => i * GS - H;
export const toI = (x: number) => Math.min(GN - 1, Math.max(0, Math.round((x + H) / GS)));

/** Floor height at every echo-grid node. */
export function floorGrid(field: HeightField): Float32Array {
  const g = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) g[j * GN + i] = field.heightAt(toW(i), toW(j));
  return g;
}

export interface Route {
  points: Array<[number, number]>;
  length: number;
  /** Meters of the route where the floor is not below the layer. */
  exposed: number;
  maxExposedRun: number;
}

const EXPOSED_COST = 10;

class Heap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export const isHidden = (floorY: number, layerY: number) => floorY < layerY - LAYER.clearance;

export function findRoute(floor: Float32Array, layerY: number, from: readonly [number, number], to: readonly [number, number]): Route {
  const start = toI(from[1]) * GN + toI(from[0]);
  const goal = toI(to[1]) * GN + toI(to[0]);
  const dist = new Float64Array(GN * GN).fill(Infinity);
  const prev = new Int32Array(GN * GN).fill(-1);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  const nb: Array<[number, number, number]> = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (heap.size) {
    const [d, n] = heap.pop();
    if (d > dist[n]) continue;
    if (n === goal) break;
    const i = n % GN;
    const j = (n / GN) | 0;
    for (const [di, dj, len] of nb) {
      const a = i + di;
      const b = j + dj;
      if (a < 1 || b < 1 || a >= GN - 1 || b >= GN - 1) continue;
      const m = b * GN + a;
      const cost = len * GS * (isHidden(floor[m], layerY) ? 1 : EXPOSED_COST);
      if (d + cost < dist[m]) {
        dist[m] = d + cost;
        prev[m] = n;
        heap.push(d + cost, m);
      }
    }
  }
  if (!Number.isFinite(dist[goal])) return { points: [], length: Infinity, exposed: Infinity, maxExposedRun: Infinity };
  const cells: number[] = [];
  for (let n = goal; n !== -1; n = prev[n]) cells.push(n);
  cells.reverse();
  const points: Array<[number, number]> = cells.map((n) => [toW(n % GN), toW((n / GN) | 0)]);
  let length = 0;
  let exposed = 0;
  let run = 0;
  let maxRun = 0;
  for (let k = 1; k < cells.length; k++) {
    const seg = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    length += seg;
    if (!isHidden(floor[cells[k]], layerY)) {
      exposed += seg;
      run += seg;
      maxRun = Math.max(maxRun, run);
    } else run = 0;
  }
  return { points, length, exposed, maxExposedRun: maxRun };
}

/** Thin a dense grid route to points about `every` meters apart. */
export function simplify(points: ReadonlyArray<readonly [number, number]>, every = 12): Array<[number, number]> {
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  const out: Array<[number, number]> = [[points[0][0], points[0][1]]];
  let acc = 0;
  for (let k = 1; k < points.length; k++) {
    acc += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    if (acc >= every || k === points.length - 1) {
      out.push([points[k][0], points[k][1]]);
      acc = 0;
    }
  }
  return out;
}
