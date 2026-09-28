import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, LineSegments } from 'three';
import { WORLD } from '../config';
import { hash01 } from '../core/rng';
import { shared } from './uniforms';
import type { TerrainField } from './terrainField';

export type GateState = 'pending' | 'passed' | 'missed';

export interface Gate {
  index: number;
  x: number;
  y: number;
  z: number;
  /** Horizontal travel direction through the gate (unit). */
  nx: number;
  nz: number;
  radius: number;
  state: GateState;
  /** Seconds since the state changed (drives the animation). */
  age: number;
  group: Group;
  ring: LineLoop;
  inner: LineLoop;
  ticks: LineSegments;
}

function circle(radius: number, segments: number): BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3));
}

function ticks(radius: number): BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push(c * radius * 1.12, s * radius * 1.12, 0, c * radius * 1.45, s * radius * 1.45, 0);
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3));
}

const RING_GEO = circle(WORLD.gateRadius, 72);
const INNER_GEO = circle(WORLD.gateRadius * 0.82, 72);
const TICK_GEO = ticks(WORLD.gateRadius);

/**
 * Gates float along the valley. Flying through one grants a speed boost and a
 * bonus scaled by the current chain; crossing its plane outside the ring breaks the chain.
 */
export class Gates {
  readonly group = new Group();
  readonly list: Gate[] = [];
  private field!: TerrainField;
  private sheet = 0;
  private originZ = 0;
  private nextIndex = 0;

  reset(field: TerrainField, sheet: number, originZ: number): void {
    for (const g of this.list) this.disposeGate(g);
    this.list.length = 0;
    this.field = field;
    this.sheet = sheet;
    this.originZ = originZ;
    this.nextIndex = 0;
  }

  private create(index: number): Gate {
    const f = this.field;
    const z = this.originZ - WORLD.gateFirst - index * WORLD.gateSpacing + (hash01(this.sheet, index, 91) - 0.5) * 80;
    const x = f.valleyCenter(z) + (hash01(this.sheet, index, 92) - 0.5) * 40;
    const agl = WORLD.gateAGLMin + hash01(this.sheet, index, 93) * (WORLD.gateAGLMax - WORLD.gateAGLMin);
    const y = f.heightAt(x, z) + agl;
    const slope = f.valleySlope(z);
    const len = Math.hypot(slope, 1);
    const nx = -slope / len;
    const nz = -1 / len;

    const mat = () => new LineBasicMaterial({ color: shared.uInk.value, transparent: true, fog: true });
    const ring = new LineLoop(RING_GEO, mat());
    const inner = new LineLoop(INNER_GEO, mat());
    const tk = new LineSegments(TICK_GEO, mat());
    const group = new Group();
    group.add(ring, inner, tk);
    group.position.set(x, y, z);
    group.rotation.y = Math.atan2(nx, nz);
    this.group.add(group);
    return { index, x, y, z, nx, nz, radius: WORLD.gateRadius, state: 'pending', age: 0, group, ring, inner, ticks: tk };
  }

  private disposeGate(g: Gate): void {
    this.group.remove(g.group);
    (g.ring.material as LineBasicMaterial).dispose();
    (g.inner.material as LineBasicMaterial).dispose();
    (g.ticks.material as LineBasicMaterial).dispose();
  }

  /** Ensure gates exist ahead of the player and drop old ones. */
  update(z: number, dt: number, time: number): void {
    const progress = this.originZ - z;
    const ahead = Math.floor((progress - WORLD.gateFirst) / WORLD.gateSpacing) + 7;
    while (this.nextIndex <= ahead) this.list.push(this.create(this.nextIndex++));
    while (this.list.length && this.list[0].z > z + 400 && this.list[0].state !== 'pending') {
      this.disposeGate(this.list.shift()!);
    }

    const next = this.list.find((g) => g.state === 'pending');
    for (const g of this.list) {
      g.age += dt;
      const ring = g.ring.material as LineBasicMaterial;
      const inner = g.inner.material as LineBasicMaterial;
      const tk = g.ticks.material as LineBasicMaterial;
      if (g.state === 'pending') {
        const isNext = g === next;
        const pulse = 0.5 + 0.5 * Math.sin(time * 5);
        ring.opacity = isNext ? 1 : 0.55;
        inner.opacity = isNext ? 0.25 + 0.35 * pulse : 0.12;
        tk.opacity = isNext ? 0.9 : 0.35;
        g.group.scale.setScalar(1);
        g.inner.scale.setScalar(isNext ? 0.92 + 0.08 * pulse : 1);
      } else if (g.state === 'passed') {
        const t = Math.min(g.age / 0.7, 1);
        const e = 1 - Math.pow(1 - t, 3);
        g.group.scale.setScalar(1 + e * 1.8);
        ring.opacity = 1 - t;
        inner.opacity = (1 - t) * 0.6;
        tk.opacity = 1 - t;
        g.group.visible = t < 1;
      } else {
        const t = Math.min(g.age / 0.5, 1);
        ring.opacity = 0.5 * (1 - t) + 0.08 * t;
        inner.opacity = 0;
        tk.opacity = 0.08;
      }
    }
  }

  /**
   * Test the segment (a -> b) against pending gates.
   * Returns the gates whose plane was crossed this step with their outcome.
   */
  cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Array<{ gate: Gate; passed: boolean }> {
    const out: Array<{ gate: Gate; passed: boolean }> = [];
    for (const g of this.list) {
      if (g.state !== 'pending') continue;
      const sa = (ax - g.x) * g.nx + (az - g.z) * g.nz;
      const sb = (bx - g.x) * g.nx + (bz - g.z) * g.nz;
      if (sa < 0 && sb >= 0) {
        const t = sa / (sa - sb);
        const px = ax + (bx - ax) * t - g.x;
        const py = ay + (by - ay) * t - g.y;
        const pz = az + (bz - az) * t - g.z;
        const passed = Math.hypot(px, py, pz) < g.radius;
        g.state = passed ? 'passed' : 'missed';
        g.age = 0;
        out.push({ gate: g, passed });
      }
    }
    return out;
  }

  setColor(): void {
    for (const g of this.list) {
      for (const o of [g.ring, g.inner, g.ticks]) (o.material as LineBasicMaterial).color.copy(shared.uInk.value);
    }
  }
}
