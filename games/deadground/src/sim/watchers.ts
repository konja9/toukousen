import { WATCH } from '../config';
import type { HeightField } from '../field/heightfield';
import { lineOfSight, type P3 } from '../field/los';

/** A fixed tower whose searchlight spins or sweeps, or a patrol walking a loop. */
export type WatcherDef =
  | { kind: 'tower'; x: number; z: number; mode: 'spin'; speed: number; phase?: number }
  | { kind: 'tower'; x: number; z: number; mode: 'sweep'; from: number; to: number; period: number; phase?: number }
  | { kind: 'patrol'; path: ReadonlyArray<readonly [number, number]>; phase?: number };

export interface WatcherState {
  kind: 'tower' | 'patrol';
  eye: P3;
  /** Heading in radians, 0 = north (-z), clockwise. */
  heading: number;
  range: number;
  halfAngle: number;
}

const dirOf = (h: number): [number, number] => [Math.sin(h), -Math.cos(h)];
export const headingTo = (dx: number, dz: number) => Math.atan2(dx, -dz);

function pathLength(path: WatcherDef & { kind: 'patrol' }): number {
  let L = 0;
  const p = path.path;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/** Where a watcher is and where it looks at time t (deterministic). */
export function watcherAt(w: WatcherDef, t: number, field: HeightField, out?: WatcherState): WatcherState {
  const o: WatcherState = out ?? { kind: w.kind, eye: { x: 0, y: 0, z: 0 }, heading: 0, range: 0, halfAngle: 0 };
  o.kind = w.kind;
  if (w.kind === 'tower') {
    o.eye.x = w.x;
    o.eye.z = w.z;
    o.eye.y = field.heightAt(w.x, w.z) + WATCH.towerHeight;
    o.range = WATCH.towerRange;
    o.halfAngle = WATCH.towerHalfAngle;
    const ph = w.phase ?? 0;
    if (w.mode === 'spin') o.heading = ph + t * w.speed;
    else {
      const s = 0.5 - 0.5 * Math.cos(((t + ph) / w.period) * Math.PI * 2);
      o.heading = w.from + (w.to - w.from) * s;
    }
    return o;
  }
  const L = pathLength(w);
  let d = ((((w.phase ?? 0) + t) * WATCH.patrolSpeed) % L + L) % L;
  const p = w.path;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= seg) {
      const k = seg > 0 ? d / seg : 0;
      o.eye.x = a[0] + (b[0] - a[0]) * k;
      o.eye.z = a[1] + (b[1] - a[1]) * k;
      o.heading = headingTo(b[0] - a[0], b[1] - a[1]);
      break;
    }
    d -= seg;
  }
  o.eye.y = field.heightAt(o.eye.x, o.eye.z) + WATCH.patrolEye;
  o.range = WATCH.patrolRange;
  o.halfAngle = WATCH.patrolHalfAngle;
  return o;
}

/** True if the watcher can see point p (inside range and cone, with a clear line of sight). */
export function sees(s: WatcherState, p: P3, field: HeightField): boolean {
  const dx = p.x - s.eye.x;
  const dz = p.z - s.eye.z;
  const dist = Math.hypot(dx, dz);
  if (dist > s.range || dist < 0.5) return dist < 0.5;
  const [hx, hz] = dirOf(s.heading);
  const cos = (dx * hx + dz * hz) / dist;
  if (cos < Math.cos(s.halfAngle)) return false;
  return lineOfSight(field, s.eye, p);
}

/** Alert gained per second from one watcher that sees the player at distance d. */
export function alertRate(d: number, range: number): number {
  return WATCH.alertRate * (1 - 0.6 * Math.min(d / range, 1));
}
