import { CONTACT, LAYER } from '../config';
import { hash01 } from '../core/rng';
import { crossesLayer, floorAt } from '../field/grid';
import type { P3 } from '../field/los';
import type { ContactDef, ContactKind } from './sector';

/**
 * Ships, listening buoys and hunter subs share one behaviour:
 * patrol -> (hear something) search -> (ping finds you) hunt -> give up -> return -> patrol.
 * Everything is a function of the world clock and the inputs, so the
 * whole thing replays exactly (tests rely on this).
 */

export type Mode = 'patrol' | 'search' | 'hunt' | 'return';

export const SEARCH_SPEED = 4.6;

/** Effective hearing distance between a listener and a sound source. */
export function hearingRange(radius: number, ears: number, listenerY: number, sourceY: number, layerY: number): number {
  return radius * ears * (crossesLayer(listenerY, sourceY, layerY) ? LAYER.attenuation : 1);
}

function loopLength(path: ReadonlyArray<readonly [number, number]>, closed: boolean): number {
  let L = 0;
  const n = closed ? path.length : path.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

function along(path: ReadonlyArray<readonly [number, number]>, closed: boolean, s: number): [number, number, number] {
  const n = closed ? path.length : path.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= seg || i === n - 1) {
      const k = seg > 0 ? Math.min(s / seg, 1) : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], -(b[1] - a[1]))];
    }
    s -= seg;
  }
  return [path[0][0], path[0][1], 0];
}

export class Contact {
  readonly kind: ContactKind;
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  speed = 0;
  mode: Mode = 'patrol';
  target: P3 | null = null;
  /** Last time it heard or detected the sub. */
  lastContact = -1e9;
  lastDetect = -1e9;
  nextPing = 0;
  attackReady = 0;
  private s = 0;
  private dir = 1;
  private wander = 0;
  readonly length: number;
  readonly closed: boolean;

  constructor(
    readonly def: ContactDef,
    readonly id: number,
    private readonly floor: Float32Array,
  ) {
    this.kind = def.kind;
    this.closed = def.kind === 'ship';
    this.length = loopLength(def.path, this.closed);
    this.s = this.length > 0 ? (((def.phase * CONTACT.shipSpeed) % this.length) + this.length) % this.length : 0;
    const [x, z, h] = along(def.path, this.closed, this.s);
    this.x = x;
    this.z = z;
    this.heading = h;
    this.y = this.cruiseY(x, z, def.y);
  }

  get ears(): number {
    return CONTACT.ears[this.kind] ?? 1;
  }

  /** Surface ships stay at the surface; subs keep clear of the floor. */
  private cruiseY(x: number, z: number, want: number): number {
    if (this.kind !== 'hunter') return this.def.y;
    return Math.max(want, floorAt(this.floor, x, z) + 8);
  }

  /** Heard something at `est` (an estimate of where the sub is). */
  alert(t: number, est: P3): void {
    if (this.kind === 'buoy') return;
    this.lastContact = t;
    if (this.mode === 'hunt' && t - this.lastDetect < 6) return;
    this.mode = 'search';
    this.target = { ...est };
    this.wander = 0;
    this.nextPing = Math.min(Math.max(this.nextPing, t + 0.4), t + 1.2);
  }

  /** Its ping came back from the sub at `p`. */
  detect(t: number, p: P3): void {
    this.mode = 'hunt';
    this.target = { ...p };
    this.lastContact = t;
    this.lastDetect = t;
  }

  /** Does it want to ping now? Only while searching or hunting. */
  wantsPing(t: number): boolean {
    if (this.kind === 'buoy' || (this.mode !== 'search' && this.mode !== 'hunt')) return false;
    if (t < this.nextPing) return false;
    this.nextPing = t + CONTACT.pingEvery * (this.mode === 'hunt' ? 0.75 : 1);
    return true;
  }

  step(dt: number, t: number): void {
    if (this.kind === 'buoy') return;
    if ((this.mode === 'search' || this.mode === 'hunt') && t - this.lastContact > CONTACT.giveUp) {
      this.mode = 'return';
      this.target = null;
    }
    if (this.mode === 'patrol') {
      const v = this.kind === 'hunter' ? CONTACT.subSpeed : CONTACT.shipSpeed;
      if (this.closed) this.s = (this.s + v * dt) % this.length;
      else {
        this.s += v * dt * this.dir;
        if (this.s > this.length) {
          this.s = 2 * this.length - this.s;
          this.dir = -1;
        } else if (this.s < 0) {
          this.s = -this.s;
          this.dir = 1;
        }
      }
      const [x, z, h] = along(this.def.path, this.closed, this.s);
      const hh = this.closed || this.dir > 0 ? h : h + Math.PI;
      this.moveTo(x, z, this.def.y, v * 1.5, dt, hh);
      return;
    }
    if (this.mode === 'return') {
      // head back to the nearest point of the patrol path, then resume
      let best = 0;
      let bestD = Infinity;
      const steps = Math.max(8, Math.ceil(this.length / 10));
      for (let k = 0; k <= steps; k++) {
        const s = (k / steps) * this.length;
        const [x, z] = along(this.def.path, this.closed, s);
        const d = Math.hypot(x - this.x, z - this.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (bestD < 4) {
        this.s = best;
        this.mode = 'patrol';
        return;
      }
      const [x, z] = along(this.def.path, this.closed, best);
      this.moveTo(x, z, this.def.y, SEARCH_SPEED, dt);
      return;
    }
    const tg = this.target!;
    const v = this.mode === 'hunt' ? CONTACT.huntSpeed : SEARCH_SPEED;
    const d = Math.hypot(tg.x - this.x, tg.z - this.z);
    if (this.mode === 'search' && d < 12) {
      // nothing here: widen the search around the estimate
      this.wander++;
      const a = hash01(this.id, this.wander, 5) * Math.PI * 2;
      const r = 30 + this.wander * 12;
      tg.x = Math.min(Math.max(tg.x + Math.cos(a) * r, -280), 280);
      tg.z = Math.min(Math.max(tg.z + Math.sin(a) * r, -280), 280);
    }
    this.moveTo(tg.x, tg.z, tg.y, v, dt);
  }

  private moveTo(x: number, z: number, y: number, v: number, dt: number, face?: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    const d = Math.hypot(dx, dz);
    const stepLen = Math.min(d, v * dt);
    if (d > 1e-6) {
      this.x += (dx / d) * stepLen;
      this.z += (dz / d) * stepLen;
    }
    const want = face ?? (d > 0.5 ? Math.atan2(dx, -dz) : this.heading);
    const dh = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    this.heading += dh * Math.min(1, 2 * dt);
    this.speed = stepLen / Math.max(dt, 1e-6);
    const wantY = this.cruiseY(this.x, this.z, this.kind === 'hunter' ? Math.min(y, this.def.y + 40) : y);
    this.y += Math.max(-2 * dt, Math.min(2 * dt, wantY - this.y));
    if (this.kind === 'hunter') this.y = Math.max(this.y, floorAt(this.floor, this.x, this.z) + 5);
  }

  /** How far away its own machinery can be heard (for the player's passive sonar). */
  get loudness(): number {
    if (this.kind === 'buoy') return 0;
    if (this.kind === 'ship') return 380 + this.speed * 20;
    return 140 + this.speed * 25;
  }
}

/** Where a listener thinks a heard sound came from: the truth plus an error that grows with distance. */
export function estimate(p: P3, dist: number, t: number, id: number): P3 {
  const a = hash01(Math.floor(t * 10), id, 21) * Math.PI * 2;
  const r = CONTACT.hearError * dist * hash01(Math.floor(t * 10), id, 22);
  return { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r };
}
