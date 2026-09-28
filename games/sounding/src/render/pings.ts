import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments } from 'three';
import type { World } from '../sim/world';
import { shared } from './uniforms';

/**
 * The visible wavefronts: a horizontal ring at the ping's depth growing with
 * the sound, plus a fainter ring a beat behind it. Our own pings are solid;
 * theirs are broken into dashes. Directional pings draw only their arc.
 */

function ring(n: number, from: number, to: number, dashed: boolean): BufferGeometry {
  const out: number[] = [];
  for (let s = 0; s < n; s++) {
    if (dashed && s % 2) continue;
    const a0 = from + ((to - from) * s) / n;
    const a1 = from + ((to - from) * (s + 1)) / n;
    out.push(Math.sin(a0), 0, -Math.cos(a0), Math.sin(a1), 0, -Math.cos(a1));
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
}

const FULL = ring(128, 0, Math.PI * 2, false);
const FULL_DASHED = ring(96, 0, Math.PI * 2, true);

interface Slot {
  lead: LineSegments;
  trail: LineSegments;
}

export class Pings {
  readonly group = new Group();
  private readonly slots: Slot[] = [];
  private readonly mats: LineBasicMaterial[] = [];
  private readonly arcs = new Map<number, BufferGeometry>();

  private slot(i: number): Slot {
    while (this.slots.length <= i) {
      const mk = () => {
        const m = new LineBasicMaterial({ transparent: true, depthWrite: false });
        m.color.copy(shared.uInk.value);
        this.mats.push(m);
        const l = new LineSegments(FULL, m);
        l.frustumCulled = false;
        this.group.add(l);
        return l;
      };
      this.slots.push({ lead: mk(), trail: mk() });
    }
    return this.slots[i];
  }

  syncColors(): void {
    for (const m of this.mats) m.color.copy(shared.uInk.value);
  }

  update(w: World): void {
    let i = 0;
    for (const { ping } of w.pings) {
      const front = (w.t - ping.t0) * ping.speed;
      if (front < 0 || front > ping.range + 30) continue;
      const s = this.slot(i++);
      const own = ping.kind === 'own';
      let geo = own ? FULL : FULL_DASHED;
      let yaw = 0;
      if (ping.dir && ping.cos !== undefined) {
        const half = Math.acos(ping.cos);
        const key = Math.round(half * 1000);
        if (!this.arcs.has(key)) this.arcs.set(key, ring(32, -half, half, false));
        geo = this.arcs.get(key)!;
        yaw = Math.atan2(ping.dir[0], -ping.dir[1]);
      }
      const k = Math.min(front / ping.range, 1);
      const base = (own ? 0.85 : 0.5) * Math.pow(1 - k, 0.8);
      for (const [obj, lag, a] of [
        [s.lead, 0, base],
        [s.trail, 9, base * 0.35],
      ] as Array<[LineSegments, number, number]>) {
        const r = Math.max(0.1, Math.min(front - lag, ping.range));
        obj.geometry = geo;
        obj.visible = front - lag > 0;
        obj.position.set(ping.x, ping.y, ping.z);
        obj.rotation.set(0, -yaw, 0);
        obj.scale.set(r, 1, r);
        (obj.material as LineBasicMaterial).opacity = a;
      }
    }
    for (; i < this.slots.length; i++) {
      this.slots[i].lead.visible = false;
      this.slots[i].trail.visible = false;
    }
  }
}
