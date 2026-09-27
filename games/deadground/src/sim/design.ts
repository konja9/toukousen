import { FIELD } from '../config';
import { hash01 } from '../core/rng';
import { findFeatures, type Feature } from '../field/features';
import { generate, type TerrainParams } from '../field/generate';
import type { HeightField } from '../field/heightfield';
import { lineOfSight } from '../field/los';
import { exposureMap, findRoute, GN, GRID, pointExposure, type Route } from '../field/path';
import type { Control } from './course';
import { headingTo, type WatcherDef } from './watchers';
import { PLAYER, WATCH } from '../config';

/**
 * Course generator used while authoring sheets (and by tests to re-validate
 * them). Controls sit on detected features around a loop; towers stand on
 * peaks overlooking the direct lines between controls; patrols circle hills.
 */

export interface DesignSpec {
  seed: number;
  terrain?: Omit<TerrainParams, 'seed'>;
  controls: number;
  sweepTowers: number;
  spinTowers: number;
  patrols: number;
  variant?: number;
}

export interface Design {
  terrain: TerrainParams;
  start: readonly [number, number];
  controls: Control[];
  finish: readonly [number, number];
  watchers: WatcherDef[];
}

export interface Validation {
  ok: boolean;
  reasons: string[];
  routes: Route[];
  routeLength: number;
  maxExposedRun: number;
  /** Worst exposure x distance along one watched stretch of the best route. */
  maxDanger: number;
  /** Fraction of the straight-line course that is watched (how much the watchers matter). */
  directExposure: number;
}

const inside = (x: number, z: number, m: number) => Math.abs(x) < FIELD.half - m && Math.abs(z) < FIELD.half - m;

export function design(spec: DesignSpec): Design | null {
  const terrain: TerrainParams = { seed: spec.seed, ...spec.terrain };
  const field = generate(terrain);
  const feats = findFeatures(field).filter((f) => inside(f.x, f.z, 30));
  const v = spec.variant ?? 0;
  const r = (k: number) => hash01(spec.seed * 7 + v, k, 3);

  // start in a corner region, course loops around the map centre
  const a0 = r(1) * Math.PI * 2;
  const start: [number, number] = [Math.cos(a0) * 185, Math.sin(a0) * 185];
  const used: Feature[] = [];
  const controls: Control[] = [];
  const n = spec.controls;
  const dir = r(2) < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = a0 + dir * (((i + 1) / (n + 1)) * Math.PI * 1.7);
    const rad = 95 + r(10 + i) * 75;
    const wx = Math.cos(a) * rad;
    const wz = Math.sin(a) * rad;
    let best: Feature | null = null;
    let bestD = 60;
    for (const f of feats) {
      if (used.includes(f)) continue;
      const d = Math.hypot(f.x - wx, f.z - wz);
      const prev = controls[controls.length - 1] ?? { x: start[0], z: start[1] };
      const leg = Math.hypot(f.x - prev.x, f.z - prev.z);
      if (leg < 60) continue;
      if (controls.length && f.kind === controls[controls.length - 1].kind && d > bestD * 0.6) continue;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) return null;
    used.push(best);
    controls.push({ x: best.x, z: best.z, kind: best.kind });
  }
  const aF = a0 + dir * Math.PI * 1.85;
  const finish: [number, number] = [Math.cos(aF) * 175, Math.sin(aF) * 175];

  // candidate tower sites: peaks away from the course points
  const course = [start, ...controls.map((c) => [c.x, c.z] as [number, number]), finish];
  const legSamples: Array<[number, number]> = [];
  for (let i = 0; i + 1 < course.length; i++) {
    for (let t = 0.15; t < 0.9; t += 0.1) {
      legSamples.push([course[i][0] + (course[i + 1][0] - course[i][0]) * t, course[i][1] + (course[i + 1][1] - course[i][1]) * t]);
    }
  }
  const sites = findFeatures(field)
    .filter((f) => f.kind === 'peak' && inside(f.x, f.z, 20))
    .filter((f) => course.every(([x, z]) => Math.hypot(f.x - x, f.z - z) > 55))
    .map((f) => {
      const eye = { x: f.x, y: f.h + WATCH.towerHeight, z: f.z };
      const seen = legSamples.filter(([x, z]) => {
        const d = Math.hypot(x - f.x, z - f.z);
        return d < WATCH.towerRange * 0.9 && lineOfSight(field, eye, { x, y: field.heightAt(x, z) + PLAYER.eyeStand, z }, 3);
      });
      const seesControls = controls.filter((c) => Math.hypot(c.x - f.x, c.z - f.z) < WATCH.towerRange && lineOfSight(field, eye, { x: c.x, y: field.heightAt(c.x, c.z) + PLAYER.eyeStand, z: c.z }, 3)).length;
      return { f, seen, score: seen.length - 4 * seesControls + r(Math.round(f.x * 13 + f.z)) * 2 };
    })
    .sort((a, b) => b.score - a.score);

  const watchers: WatcherDef[] = [];
  const pickSite = () => {
    const s = sites.find((c) => watchers.every((w) => w.kind !== 'tower' || Math.hypot(w.x - c.f.x, w.z - c.f.z) > 90));
    if (s) sites.splice(sites.indexOf(s), 1);
    return s;
  };
  for (let i = 0; i < spec.sweepTowers; i++) {
    const s = pickSite();
    if (!s || !s.seen.length) return null;
    // sweep across the watched part of the course
    const hs = s.seen.map(([x, z]) => headingTo(x - s.f.x, z - s.f.z));
    const mid = Math.atan2(hs.reduce((a, h) => a + Math.sin(h), 0), hs.reduce((a, h) => a + Math.cos(h), 0));
    watchers.push({ kind: 'tower', x: s.f.x, z: s.f.z, mode: 'sweep', from: mid - 1.1, to: mid + 1.1, period: 9 + r(40 + i) * 4, phase: r(50 + i) * 8 });
  }
  for (let i = 0; i < spec.spinTowers; i++) {
    const s = pickSite();
    if (!s) return null;
    watchers.push({ kind: 'tower', x: s.f.x, z: s.f.z, mode: 'spin', speed: (r(60 + i) < 0.5 ? -1 : 1) * (0.42 + r(61 + i) * 0.2), phase: r(62 + i) * 6 });
  }
  for (let i = 0; i < spec.patrols; i++) {
    // circle a hill that one of the legs passes near
    const hills = feats.filter((f) => f.kind === 'peak' && !used.includes(f) && watchers.every((w) => w.kind !== 'patrol' || Math.hypot(w.path[0][0] - f.x, w.path[0][1] - f.z) > 70));
    const target = legSamples[Math.floor(r(70 + i) * legSamples.length)];
    hills.sort((a, b) => Math.hypot(a.x - target[0], a.z - target[1]) - Math.hypot(b.x - target[0], b.z - target[1]));
    const hill = hills[0];
    if (!hill) return null;
    const rad = 28 + r(80 + i) * 14;
    const path: Array<[number, number]> = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      path.push([hill.x + Math.cos(a) * rad, hill.z + Math.sin(a) * rad]);
    }
    if (!path.every(([x, z]) => inside(x, z, 12))) return null;
    watchers.push({ kind: 'patrol', path, phase: r(90 + i) * 30 });
  }
  // move start and finish along the edge of the sheet to where nobody is watching
  const hide = (angle: number): [number, number] => {
    let best: [number, number] = [Math.cos(angle) * 185, Math.sin(angle) * 185];
    let bestScore = Infinity;
    for (let k = -4; k <= 4; k++) {
      for (const rad of [170, 185, 200]) {
        const a = angle + k * 0.12;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const score = pointExposure(field, watchers, x, z) * 100 + Math.abs(k) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = [x, z];
        }
      }
    }
    return best;
  };
  if (watchers.length) {
    const s2 = hide(a0);
    start[0] = s2[0];
    start[1] = s2[1];
    const f2 = hide(aF);
    finish[0] = f2[0];
    finish[1] = f2[1];
  }
  return { terrain, start, controls, finish, watchers };
}

export function validate(field: HeightField, d: Design): Validation {
  const reasons: string[] = [];
  const ex = exposureMap(field, d.watchers);
  const exAt = (x: number, z: number) => {
    const i = Math.round((x + FIELD.half) / GRID);
    const j = Math.round((z + FIELD.half) / GRID);
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.max(m, ex[Math.min(GN - 1, Math.max(0, j + dj)) * GN + Math.min(GN - 1, Math.max(0, i + di))]);
    return m;
  };
  const pts: Array<readonly [number, number]> = [d.start, ...d.controls.map((c) => [c.x, c.z] as const), d.finish];
  // start and finish must be safe; controls may sit inside a sweep (time the punch)
  pts.forEach(([x, z], k) => {
    const endpoint = k === 0 || k === pts.length - 1;
    if (exAt(x, z) > (endpoint ? 0.05 : 0.45)) reasons.push(`point ${k} is watched (${exAt(x, z).toFixed(2)})`);
  });
  const routes: Route[] = [];
  let maxRun = 0;
  let maxDanger = 0;
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const rt = findRoute(field, ex, pts[k], pts[k + 1]);
    routes.push(rt);
    if (!Number.isFinite(rt.length)) reasons.push(`leg ${k} has no route`);
    maxRun = Math.max(maxRun, rt.maxExposedRun);
    maxDanger = Math.max(maxDanger, rt.maxDanger);
    total += rt.length;
    // a leg may cross swept ground, but never ground that is watched most of the time
    // (the control itself may be in a sweep; the last cells are exempt)
    const inner = rt.points.slice(2, -3);
    if (inner.some(([x, z]) => exAt(x, z) > 0.6)) reasons.push(`leg ${k} crosses constantly watched ground`);
  }
  if (maxDanger > 12) reasons.push(`danger ${maxDanger.toFixed(1)}`);
  // how much of the straight-line course is watched
  let seen = 0;
  let all = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    for (let t = 0.1; t < 0.95; t += 0.05) {
      const x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t;
      const z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
      all++;
      if (exAt(x, z) > 0.05) seen++;
    }
  }
  return { ok: reasons.length === 0, reasons, routes, routeLength: total, maxExposedRun: maxRun, maxDanger, directExposure: seen / all };
}
