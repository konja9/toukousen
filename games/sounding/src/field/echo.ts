import { ECHO, FIELD } from '../config';
import { clearPath } from './grid';
import type { P3 } from './los';

/**
 * Sonar echoes on the 4 m grid. A ping is a sphere of sound expanding from
 * its origin; every floor cell within range that the origin can see gets
 * the time the wavefront reaches it. Cells are processed nearest first and
 * only a little ahead of the wavefront, spreading the line-of-sight work
 * over the frames the wave takes to travel. The renderer turns those times
 * into the bright sweep and the afterglow; `charted` keeps what has been
 * measured for the chart.
 */

const GN = ECHO.N;
const GS = ECHO.spacing;
const H = FIELD.half;

export type PingKind = 'own' | 'enemy';

export interface Ping {
  kind: PingKind;
  x: number;
  y: number;
  z: number;
  t0: number;
  range: number;
  speed: number;
  /** Directional ping: unit heading (x, z) and cosine of the half angle. */
  dir?: [number, number];
  cos?: number;
}

interface Active {
  ping: Ping;
  cells: Int32Array;
  dist: Float32Array;
  cursor: number;
}

/** Arrival time of a ping at point p, or null when out of range, outside the cone or hidden by the floor. */
export function reach(floor: Float32Array, ping: Ping, p: P3, rangeMul = 1): number | null {
  const dx = p.x - ping.x;
  const dz = p.z - ping.z;
  const d = Math.hypot(dx, p.y - ping.y, dz);
  if (d > ping.range * rangeMul) return null;
  if (ping.dir && ping.cos !== undefined) {
    const h = Math.hypot(dx, dz);
    if (h > 1 && (dx * ping.dir[0] + dz * ping.dir[1]) / h < ping.cos) return null;
  }
  if (!clearPath(floor, ping, p)) return null;
  return ping.t0 + d / ping.speed;
}

export class Echo {
  /** Time the wavefront of the latest own / enemy ping reached each cell (or -1e9). */
  readonly own = new Float32Array(GN * GN).fill(-1e9);
  readonly enemy = new Float32Array(GN * GN).fill(-1e9);
  /** 255 where the floor has been measured (read as 1.0 by the chart texture). */
  readonly charted = new Uint8Array(GN * GN);
  /** Bumped whenever the arrays change (so textures know to re-upload). */
  version = 0;
  private active: Active[] = [];

  constructor(private readonly floor: Float32Array) {}

  reset(): void {
    this.own.fill(-1e9);
    this.enemy.fill(-1e9);
    this.charted.fill(0);
    this.active = [];
    this.version++;
  }

  ping(p: Ping): void {
    const r = p.range;
    const i0 = Math.max(0, Math.floor((p.x - r + H) / GS));
    const i1 = Math.min(GN - 1, Math.ceil((p.x + r + H) / GS));
    const j0 = Math.max(0, Math.floor((p.z - r + H) / GS));
    const j1 = Math.min(GN - 1, Math.ceil((p.z + r + H) / GS));
    const idx: number[] = [];
    const dd: number[] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const n = j * GN + i;
        const x = i * GS - H;
        const z = j * GS - H;
        const dx = x - p.x;
        const dz = z - p.z;
        const d = Math.hypot(dx, this.floor[n] - p.y, dz);
        if (d > r) continue;
        if (p.dir && p.cos !== undefined) {
          const h = Math.hypot(dx, dz);
          if (h > 1 && (dx * p.dir[0] + dz * p.dir[1]) / h < p.cos) continue;
        }
        idx.push(n);
        dd.push(d);
      }
    }
    const order = idx.map((_, k) => k).sort((a, b) => dd[a] - dd[b]);
    this.active.push({
      ping: p,
      cells: Int32Array.from(order, (k) => idx[k]),
      dist: Float32Array.from(order, (k) => dd[k]),
      cursor: 0,
    });
  }

  /** Process cells the wavefront will reach within `ahead` seconds. */
  update(now: number, ahead = 0.3): void {
    let changed = false;
    for (const a of this.active) {
      const p = a.ping;
      const out = p.kind === 'own' ? this.own : this.enemy;
      const limit = (now + ahead - p.t0) * p.speed;
      const target = { x: 0, y: 0, z: 0 };
      while (a.cursor < a.cells.length && a.dist[a.cursor] <= limit) {
        const n = a.cells[a.cursor];
        target.x = (n % GN) * GS - H;
        target.z = ((n / GN) | 0) * GS - H;
        target.y = this.floor[n] + 1.2;
        if (clearPath(this.floor, p, target)) {
          out[n] = p.t0 + a.dist[a.cursor] / p.speed;
          this.charted[n] = 255;
          changed = true;
        }
        a.cursor++;
      }
    }
    this.active = this.active.filter((a) => a.cursor < a.cells.length);
    if (changed) this.version++;
  }

  get busy(): boolean {
    return this.active.length > 0;
  }

  /** Fraction of the sector that has been measured. */
  get chartedFraction(): number {
    let s = 0;
    for (const v of this.charted) if (v) s++;
    return s / this.charted.length;
  }
}
