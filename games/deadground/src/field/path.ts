import { FIELD, PLAYER } from '../config';
import type { HeightField } from './heightfield';
import { lineOfSight } from './los';
import { watcherAt, type WatcherDef } from '../sim/watchers';

/**
 * Coarse exposure map and route search, used to prove that every course has a
 * way through the dead ground.
 */

export const GRID = 4; // meters per cell
export const GN = Math.floor((2 * FIELD.half) / GRID) + 1;
const toW = (i: number) => i * GRID - FIELD.half;

/**
 * Fraction of time (0..1) each cell is watched by at least one watcher, for a
 * standing player. Towers are sampled over one sweep/spin period, patrols over
 * their loop.
 */
export function exposureMap(field: HeightField, watchers: ReadonlyArray<WatcherDef>, samples = 24): Float32Array {
  const ex = new Float32Array(GN * GN);
  const states = watchers.map((w) => {
    const period = w.kind === 'tower' ? (w.mode === 'spin' ? (Math.PI * 2) / Math.abs(w.speed) : w.period) : patrolPeriod(w);
    return Array.from({ length: samples }, (_, k) => watcherAt(w, (k / samples) * period, field));
  });
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const x = toW(i);
      const z = toW(j);
      const p = { x, y: field.heightAt(x, z) + PLAYER.eyeStand, z };
      let hidden = samples;
      const seenAt = new Uint8Array(samples);
      for (const list of states) {
        // line of sight does not depend on the heading for towers; compute once per watcher
        let losCached: boolean | null = null;
        for (let k = 0; k < samples; k++) {
          const s = list[k];
          const dx = x - s.eye.x;
          const dz = z - s.eye.z;
          const d = Math.hypot(dx, dz);
          if (d > s.range) continue;
          const cos = d > 0.5 ? (dx * Math.sin(s.heading) - dz * Math.cos(s.heading)) / d : 1;
          if (cos < Math.cos(s.halfAngle)) continue;
          const fixedEye = list[0].eye.x === s.eye.x && list[0].eye.z === s.eye.z;
          let los: boolean;
          if (fixedEye) {
            if (losCached === null) losCached = lineOfSight(field, s.eye, p, 3);
            los = losCached;
          } else los = lineOfSight(field, s.eye, p, 3);
          if (los) seenAt[k] = 1;
        }
      }
      for (let k = 0; k < samples; k++) if (seenAt[k]) hidden--;
      ex[j * GN + i] = 1 - hidden / samples;
    }
  }
  return ex;
}

/** Exposure (0..1) of a single standing point; same sampling as exposureMap. */
export function pointExposure(field: HeightField, watchers: ReadonlyArray<WatcherDef>, x: number, z: number, samples = 24): number {
  const p = { x, y: field.heightAt(x, z) + PLAYER.eyeStand, z };
  const seenAt = new Uint8Array(samples);
  for (const w of watchers) {
    const period = w.kind === 'tower' ? (w.mode === 'spin' ? (Math.PI * 2) / Math.abs(w.speed) : w.period) : patrolPeriod(w);
    for (let k = 0; k < samples; k++) {
      if (seenAt[k]) continue;
      const s = watcherAt(w, (k / samples) * period, field);
      const dx = x - s.eye.x;
      const dz = z - s.eye.z;
      const d = Math.hypot(dx, dz);
      if (d > s.range) continue;
      const cos = d > 0.5 ? (dx * Math.sin(s.heading) - dz * Math.cos(s.heading)) / d : 1;
      if (cos < Math.cos(s.halfAngle)) continue;
      if (lineOfSight(field, s.eye, p, 3)) seenAt[k] = 1;
    }
  }
  return seenAt.reduce((a, v) => a + v, 0) / samples;
}

function patrolPeriod(w: WatcherDef & { kind: 'patrol' }): number {
  let L = 0;
  for (let i = 0; i < w.path.length; i++) {
    const a = w.path[i];
    const b = w.path[(i + 1) % w.path.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L / 1.5;
}

export interface Route {
  points: Array<[number, number]>;
  length: number;
  /** Longest run of consecutive cells with exposure above the threshold (m). */
  maxExposedRun: number;
  exposedLength: number;
  /** Largest sum of exposure x distance over one contiguous exposed run. */
  maxDanger: number;
  /** Highest exposure of any cell on the route. */
  peakExposure: number;
}

const cellOf = (v: number) => Math.min(GN - 1, Math.max(0, Math.round((v + FIELD.half) / GRID)));

/**
 * Dijkstra over the coarse grid (8-neighbour). Cost is walking distance,
 * slowed on slopes, blocked on cliffs, and heavily penalised where watched.
 */
export function findRoute(field: HeightField, exposure: Float32Array, from: readonly [number, number], to: readonly [number, number], threshold = 0.05): Route {
  const hs = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) hs[j * GN + i] = field.heightAt(toW(i), toW(j));
  const start = cellOf(from[1]) * GN + cellOf(from[0]);
  const goal = cellOf(to[1]) * GN + cellOf(to[0]);
  const dist = new Float64Array(GN * GN).fill(Infinity);
  const prev = new Int32Array(GN * GN).fill(-1);
  dist[start] = 0;
  // binary heap
  const heap: number[] = [start];
  const push = (n: number) => {
    heap.push(n);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(GN * GN);
  while (heap.length) {
    const n = pop();
    if (done[n]) continue;
    done[n] = 1;
    if (n === goal) break;
    const i = n % GN;
    const j = (n - i) / GN;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        const m = nj * GN + ni;
        if (done[m]) continue;
        const run = GRID * Math.hypot(di, dj);
        const rise = hs[m] - hs[n];
        const slope = Math.abs(rise) / run;
        if (slope > PLAYER.maxSlope * 0.7) continue;
        const e = exposure[m];
        const cost = run * (1 + slope * 0.75) * (1 + (e > threshold ? 60 * e + 4 : 0));
        const nd = dist[n] + cost;
        if (nd < dist[m]) {
          dist[m] = nd;
          prev[m] = n;
          push(m);
        }
      }
    }
  }
  const cells: number[] = [];
  for (let n = goal; n !== -1; n = prev[n]) {
    cells.push(n);
    if (n === start) break;
  }
  cells.reverse();
  const points = cells.map((n) => [toW(n % GN), toW(Math.floor(n / GN))] as [number, number]);
  let length = 0;
  let run = 0;
  let maxRun = 0;
  let exposed = 0;
  let danger = 0;
  let maxDanger = 0;
  let peak = 0;
  for (let k = 1; k < cells.length; k++) {
    const d = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    length += d;
    const e = exposure[cells[k]];
    peak = Math.max(peak, e);
    if (e > threshold) {
      run += d;
      exposed += d;
      danger += e * d;
      maxRun = Math.max(maxRun, run);
      maxDanger = Math.max(maxDanger, danger);
    } else {
      run = 0;
      danger = 0;
    }
  }
  const reached = cells[0] === start;
  return {
    points: reached ? points : [],
    length: reached ? length : Infinity,
    maxExposedRun: reached ? maxRun : Infinity,
    exposedLength: exposed,
    maxDanger: reached ? maxDanger : Infinity,
    peakExposure: reached ? peak : 1,
  };
}
