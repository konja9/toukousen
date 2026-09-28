import { FIELD, LAYER } from '../config';
import { hash01 } from '../core/rng';
import { distToPath, generate, type Carve, type SeafloorParams } from '../field/generate';
import type { HeightField } from '../field/heightfield';
import { findRoute, floorGrid, isHidden, simplify, type Route } from '../field/path';

/**
 * A sector of the dive: seafloor, thermocline, entry and exit trench, the
 * hidden route that is guaranteed to exist, and what waits along it.
 * Sectors are generated at run time from (seed, index); layouts that fail
 * validation are rebuilt with the next attempt number.
 */

export type ContactKind = 'ship' | 'buoy' | 'hunter';

export interface ContactDef {
  kind: ContactKind;
  /** Ships loop their path, hunters go back and forth, buoys stay at path[0]. */
  path: Array<[number, number]>;
  /** Cruising height (y). */
  y: number;
  phase: number;
}

export type SurveyKind = 'wreck' | 'vent' | 'mount';

export interface Survey {
  x: number;
  y: number;
  z: number;
  kind: SurveyKind;
}

export interface Sector {
  seed: number;
  index: number;
  attempt: number;
  layerY: number;
  field: HeightField;
  floor: Float32Array;
  entry: [number, number];
  entryY: number;
  entryHeading: number;
  exit: [number, number];
  exitY: number;
  /** Where the old survey says the exit is: the chart shows this circle. */
  exitHint: { x: number; z: number; r: number };
  route: Route;
  /** The route thinned to ~12 m steps. */
  path: Array<[number, number]>;
  contacts: ContactDef[];
  mines: Array<{ x: number; y: number; z: number }>;
  surveys: Survey[];
  carves: Carve[];
}

export interface Difficulty {
  layerY: number;
  shelf: number;
  relief: number;
  canyons: number;
  width: number;
  sills: number;
  ships: number;
  buoys: number;
  hunters: number;
  mines: number;
  surveys: number;
  exitY: number;
  maxExposed: number;
  minExposed: number;
}

export function difficulty(index: number): Difficulty {
  const n = Math.max(1, index);
  const k = Math.min(n - 1, 9);
  const layerY = -(95 + k * 6);
  const sills = n <= 2 ? 1 : Math.min(1 + Math.floor(n / 3), 4);
  return {
    layerY,
    shelf: 24 + k * 1.5,
    relief: 1 + k * 0.05,
    canyons: 0.55 + k * 0.04,
    width: Math.max(34 - k * 1.8, 18),
    sills,
    ships: n >= 3 ? Math.min(1 + Math.floor((n - 3) / 2), 3) : 0,
    buoys: n >= 5 ? Math.min(2 + Math.floor((n - 5) / 2), 4) : 0,
    hunters: n >= 7 ? (n >= 9 ? 2 : 1) : 0,
    mines: n >= 7 ? Math.min(4 + 2 * (n - 7), 12) : 0,
    surveys: n <= 2 ? 2 : 3,
    exitY: layerY - 110 - Math.min(n, 12) * 8,
    maxExposed: 40 + sills * 28,
    minExposed: n >= 3 ? 12 : 0,
  };
}

const EDGE = FIELD.half - 30;
const clampIn = (v: number, m = EDGE) => Math.min(Math.max(v, -m), m);

function catmull(pts: Array<[number, number]>, sub = 8): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function pointAt(path: ReadonlyArray<readonly [number, number]>, t: number): [number, number] {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  let want = t * total;
  for (let i = 0; i + 1 < path.length; i++) {
    const L = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    if (want <= L) {
      const k = L > 0 ? want / L : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
    }
    want -= L;
  }
  const last = path[path.length - 1];
  return [last[0], last[1]];
}

interface Layout {
  params: SeafloorParams;
  entry: [number, number];
  exit: [number, number];
  carves: Carve[];
  d: Difficulty;
  r: (k: number) => number;
}

function layout(seed: number, index: number, attempt: number): Layout {
  const d = difficulty(index);
  const r = (k: number) => hash01(seed * 31 + index, attempt * 1000 + k, 7);
  const a0 = r(1) * Math.PI * 2;
  const entry: [number, number] = [Math.cos(a0) * 262, Math.sin(a0) * 262];
  const aE = a0 + Math.PI + (r(2) - 0.5) * 1.2;
  const rE = 150 + r(3) * 70;
  const exit: [number, number] = [clampIn(Math.cos(aE) * rE, 240), clampIn(Math.sin(aE) * rE, 240)];

  // main canyon: entry -> jittered midpoints -> exit
  const dx = exit[0] - entry[0];
  const dz = exit[1] - entry[1];
  const L = Math.hypot(dx, dz);
  const nx = -dz / L;
  const nz = dx / L;
  const ctrl: Array<[number, number]> = [entry];
  const mids = 3;
  for (let i = 1; i <= mids; i++) {
    const t = i / (mids + 1);
    const off = (r(10 + i) - 0.5) * 230;
    ctrl.push([clampIn(entry[0] + dx * t + nx * off), clampIn(entry[1] + dz * t + nz * off)]);
  }
  ctrl.push(exit);
  const main = catmull(ctrl);
  const sills: Carve['sills'][number][] = [];
  for (let s = 0; s < d.sills; s++) {
    const t = 0.18 + ((s + 0.5 + (r(20 + s) - 0.5) * 0.6) / d.sills) * 0.64;
    sills.push({ t, y: d.layerY + 8 + r(30 + s) * 10, len: 12 + r(40 + s) * 8 });
  }
  const carves: Carve[] = [{ path: main, width: d.width, floor: d.layerY - 28 - r(4) * 10, sills }];

  // one or two dead-end branches
  const branches = 1 + (r(5) < 0.5 ? 1 : 0);
  for (let b = 0; b < branches; b++) {
    const t = 0.25 + r(50 + b) * 0.5;
    const [bx, bz] = pointAt(main, t);
    const ang = Math.atan2(nz, nx) + (r(60 + b) < 0.5 ? 0 : Math.PI) + (r(70 + b) - 0.5) * 0.9;
    const len = 110 + r(80 + b) * 90;
    const mid: [number, number] = [clampIn(bx + Math.cos(ang) * len * 0.5 + (r(90 + b) - 0.5) * 40), clampIn(bz + Math.sin(ang) * len * 0.5 + (r(95 + b) - 0.5) * 40)];
    const end: [number, number] = [clampIn(bx + Math.cos(ang) * len), clampIn(bz + Math.sin(ang) * len)];
    carves.push({ path: catmull([[bx, bz], mid, end], 6), width: d.width * 0.8, floor: d.layerY - 18 - r(100 + b) * 12, sills: [] });
  }

  const seamounts: SeafloorParams['seamounts'][number][] = [];
  const nMounts = 2 + Math.floor(r(6) * 3);
  for (let m = 0; m < nMounts * 4 && seamounts.length < nMounts; m++) {
    const x = (r(200 + m) - 0.5) * 2 * EDGE;
    const z = (r(300 + m) - 0.5) * 2 * EDGE;
    if (Math.hypot(x - entry[0], z - entry[1]) < 110 || Math.hypot(x - exit[0], z - exit[1]) < 110) continue;
    seamounts.push({ x, z, r: 45 + r(400 + m) * 35, top: -(40 + r(500 + m) * 30) });
  }

  const params: SeafloorParams = {
    seed: seed * 131 + index * 17 + attempt,
    layerY: d.layerY,
    shelf: d.shelf,
    relief: d.relief,
    canyons: d.canyons,
    seamounts,
    carves,
    exit: { x: exit[0], z: exit[1], r: 30, y: d.exitY },
    entry: { x: entry[0], z: entry[1], r: 42, y: d.layerY - 30 },
  };
  return { params, entry, exit, carves, d, r };
}

export interface SectorCheck {
  ok: boolean;
  reasons: string[];
}

export function checkSector(s: Pick<Sector, 'route' | 'layerY' | 'field' | 'entry' | 'exit' | 'exitY'>, d: Difficulty): SectorCheck {
  const reasons: string[] = [];
  if (!Number.isFinite(s.route.length)) reasons.push('no route');
  if (s.route.exposed > d.maxExposed) reasons.push(`exposed ${s.route.exposed.toFixed(0)} m > ${d.maxExposed}`);
  if (s.route.exposed < d.minExposed) reasons.push(`exposed ${s.route.exposed.toFixed(0)} m < ${d.minExposed}`);
  if (s.route.length > 1250) reasons.push(`route ${s.route.length.toFixed(0)} m too long`);
  if (!isHidden(s.field.heightAt(s.entry[0], s.entry[1]), s.layerY)) reasons.push('entry not below the layer');
  if (s.field.heightAt(s.exit[0], s.exit[1]) > s.layerY - 70) reasons.push('exit trench too shallow');
  return { ok: reasons.length === 0, reasons };
}

const MAX_ATTEMPTS = 12;

export function buildSector(seed: number, index: number): Sector {
  let fallback: Sector | null = null;
  let fallbackMiss = Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const lay = layout(seed, index, attempt);
    const field = generate(lay.params);
    const floor = floorGrid(field);
    const route = findRoute(floor, lay.d.layerY, lay.entry, lay.exit);
    const partial = { route, layerY: lay.d.layerY, field, entry: lay.entry, exit: lay.exit, exitY: lay.d.exitY };
    const check = checkSector(partial, lay.d);
    const sector = populate(seed, index, attempt, lay, field, floor, route);
    if (check.ok) return sector;
    const miss = Math.max(0, route.exposed - lay.d.maxExposed) + Math.max(0, lay.d.minExposed - route.exposed) + (check.reasons.length - 1) * 1000;
    if (!fallback || miss < fallbackMiss) {
      fallback = sector;
      fallbackMiss = miss;
    }
  }
  return fallback!;
}

function populate(seed: number, index: number, attempt: number, lay: Layout, field: HeightField, floor: Float32Array, route: Route): Sector {
  const { d, r, entry, exit, carves } = lay;
  const path = simplify(route.points, 12);
  const main = carves[0];
  const onRoute = (x: number, z: number) => distToPath(path, x, z)[0];

  // exposed stretches of the route (where it crosses a sill or a ridge)
  const exposedPts = path.filter(([x, z]) => !isHidden(field.heightAt(x, z), d.layerY));
  const hotspots: Array<[number, number]> = exposedPts.length ? exposedPts : [pointAt(path, 0.5)];

  const contacts: ContactDef[] = [];
  for (let s = 0; s < d.ships; s++) {
    const [hx, hz] = hotspots[Math.floor((s + r(600)) * (hotspots.length / Math.max(d.ships, 1))) % hotspots.length];
    const cx = clampIn(hx + (r(610 + s) - 0.5) * 80, 220);
    const cz = clampIn(hz + (r(620 + s) - 0.5) * 80, 220);
    const rx = 70 + r(630 + s) * 50;
    const rz = 50 + r(640 + s) * 50;
    const rot = r(650 + s) * Math.PI;
    const loop: Array<[number, number]> = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 * (r(660 + s) < 0.5 ? 1 : -1);
      const ex = Math.cos(a) * rx;
      const ez = Math.sin(a) * rz;
      loop.push([clampIn(cx + ex * Math.cos(rot) - ez * Math.sin(rot), 270), clampIn(cz + ex * Math.sin(rot) + ez * Math.cos(rot), 270)]);
    }
    contacts.push({ kind: 'ship', path: loop, y: -4, phase: r(670 + s) * 120 });
  }
  for (let b = 0; b < d.buoys; b++) {
    const [px, pz] = pointAt(path, 0.15 + ((b + r(700 + b)) / Math.max(d.buoys, 1)) * 0.75);
    const side = r(710 + b) < 0.5 ? -1 : 1;
    const off = 35 + r(720 + b) * 50;
    let k = 0;
    for (let q = 1; q < path.length - 1; q++) if (Math.hypot(path[q][0] - px, path[q][1] - pz) < Math.hypot(path[k][0] - px, path[k][1] - pz)) k = q;
    k = Math.min(k, path.length - 2);
    const tx = path[k + 1][0] - path[k][0];
    const tz = path[k + 1][1] - path[k][1];
    const tl = Math.hypot(tx, tz) || 1;
    const x = clampIn(px - (tz / tl) * off * side, 270);
    const z = clampIn(pz + (tx / tl) * off * side, 270);
    // alternate shallow hydrophones and deep ones hung below the layer
    const deep = b % 2 === 1 && field.heightAt(x, z) < d.layerY - 20;
    contacts.push({ kind: 'buoy', path: [[x, z]], y: deep ? d.layerY - 10 : -30, phase: 0 });
  }
  for (let h = 0; h < d.hunters; h++) {
    const a = 0.25 + h * 0.3 + r(800 + h) * 0.1;
    const i0 = Math.floor(path.length * a);
    const i1 = Math.min(path.length - 1, i0 + Math.floor(path.length * 0.3));
    const seg = path.slice(i0, i1 + 1).map(([x, z]) => [x, z] as [number, number]);
    if (seg.length >= 2) contacts.push({ kind: 'hunter', path: seg, y: d.layerY - 12, phase: r(810 + h) * 60 });
  }

  // mines: in the side branches and beside the main canyon, never on the route
  const mines: Sector['mines'] = [];
  const mineSources = carves.slice(1).concat(main);
  for (let m = 0; m < d.mines * 6 && mines.length < d.mines; m++) {
    const c = mineSources[m % mineSources.length];
    const [x, z] = pointAt(c.path, 0.1 + r(900 + m) * 0.85);
    const jx = x + (r(910 + m) - 0.5) * c.width;
    const jz = z + (r(920 + m) - 0.5) * c.width;
    if (onRoute(jx, jz) < 16) continue;
    if (Math.hypot(jx - entry[0], jz - entry[1]) < 60 || Math.hypot(jx - exit[0], jz - exit[1]) < 40) continue;
    const fy = field.heightAt(jx, jz);
    mines.push({ x: jx, y: Math.min(fy + 10 + r(930 + m) * 16, d.layerY - 6), z: jz });
  }

  // survey targets: wrecks in the branches, vents in deep holes, seamount tops
  const surveys: Survey[] = [];
  const candidates: Survey[] = [];
  for (const c of carves.slice(1)) {
    const [x, z] = c.path[c.path.length - 1];
    candidates.push({ x, z, y: field.heightAt(x, z) + 2, kind: 'wreck' });
  }
  for (const s of lay.params.seamounts) candidates.push({ x: s.x, z: s.z, y: field.heightAt(s.x, s.z) + 2, kind: 'mount' });
  for (let v = 0; v < 12; v++) {
    const x = (r(1000 + v) - 0.5) * 2 * EDGE;
    const z = (r(1010 + v) - 0.5) * 2 * EDGE;
    const y = field.heightAt(x, z);
    if (y < d.layerY - 25) candidates.push({ x, z, y: y + 2, kind: 'vent' });
  }
  for (const c of candidates) {
    if (surveys.length >= d.surveys) break;
    const dr = onRoute(c.x, c.z);
    if (dr < 40 || dr > 200) continue;
    if (surveys.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 90)) continue;
    if (Math.hypot(c.x - exit[0], c.z - exit[1]) < 60) continue;
    surveys.push(c);
  }

  const hintOff = 25 + r(1100) * 30;
  const hintA = r(1101) * Math.PI * 2;
  const next = path[Math.min(3, path.length - 1)];
  return {
    seed,
    index,
    attempt,
    layerY: d.layerY,
    field,
    floor,
    entry,
    entryY: d.layerY - 12,
    entryHeading: Math.atan2(next[0] - entry[0], -(next[1] - entry[1])),
    exit,
    exitY: d.exitY,
    exitHint: { x: exit[0] + Math.cos(hintA) * hintOff, z: exit[1] + Math.sin(hintA) * hintOff, r: 85 },
    route,
    path,
    contacts,
    mines,
    surveys,
    carves,
  };
}

/** Height a cruising sub keeps along the hidden route (below the layer, above the floor). */
export function cruiseY(s: Pick<Sector, 'layerY'>): number {
  return s.layerY - LAYER.clearance / 2;
}
