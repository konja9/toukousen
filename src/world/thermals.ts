import { BufferAttribute, BufferGeometry, Group, LineSegments, ShaderMaterial, Vector3 } from 'three';
import { WORLD } from '../config';
import { hash01 } from '../core/rng';
import { shared } from './uniforms';
import type { TerrainField } from './terrainField';

/**
 * Thermals: rising columns of air drawn as stacked rings — the contour lines
 * of an invisible cylinder. Placed deterministically per 800 m cell.
 */

export interface Thermal {
  x: number;
  z: number;
  ground: number;
  radius: number;
  lift: number;
  top: number;
  phase: number;
}

const RING_SPACING = 44;
const RING_SEGMENTS = 56;
const MAX_RINGS = Math.ceil(WORLD.thermalHeight / RING_SPACING);

const vertexShader = /* glsl */ `
attribute float aRing;
uniform vec3 uBase;
uniform float uRadius;
uniform float uTop;
uniform float uTime;
uniform float uPhase;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float y = mod(aRing * ${RING_SPACING.toFixed(1)} + uTime * 16.0 + uPhase, uTop);
  float ang = atan(position.z, position.x);
  float r = uRadius * (0.62 + 0.38 * smoothstep(0.0, uTop * 0.45, y));
  r *= 1.0 + 0.035 * sin(ang * 3.0 + uTime * 0.9 + aRing * 0.7);
  vec3 wp = uBase + vec3(position.x * r, y, position.z * r);
  vAlpha = smoothstep(0.0, 50.0, y) * (1.0 - smoothstep(uTop * 0.6, uTop, y));
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInk;
uniform float uFogDist;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float dist = distance(vWorld, cameraPosition);
  float fog = exp(-pow(dist / uFogDist, 2.2));
  float near = 0.35 + 0.65 * smoothstep(20.0, 140.0, dist);
  gl_FragColor = vec4(uInk, vAlpha * fog * near * uOpacity * 0.5);
}
`;

let ringGeometry: BufferGeometry | null = null;
function getRingGeometry(): BufferGeometry {
  if (ringGeometry) return ringGeometry;
  const segs = MAX_RINGS * RING_SEGMENTS;
  const pos = new Float32Array(segs * 2 * 3);
  const ring = new Float32Array(segs * 2);
  let k = 0;
  for (let r = 0; r < MAX_RINGS; r++) {
    for (let s = 0; s < RING_SEGMENTS; s++) {
      for (const e of [s, s + 1]) {
        const a = (e / RING_SEGMENTS) * Math.PI * 2;
        pos[k * 3] = Math.cos(a);
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = Math.sin(a);
        ring[k] = r;
        k++;
      }
    }
  }
  ringGeometry = new BufferGeometry();
  ringGeometry.setAttribute('position', new BufferAttribute(pos, 3));
  ringGeometry.setAttribute('aRing', new BufferAttribute(ring, 1));
  return ringGeometry;
}

interface Entry {
  cell: number;
  thermals: Thermal[];
  objects: LineSegments[];
}

export class Thermals {
  readonly group = new Group();
  private readonly cells = new Map<number, Entry>();
  private field!: TerrainField;
  private sheet = 0;
  private originZ = 0;

  reset(field: TerrainField, sheet: number, originZ: number): void {
    for (const e of this.cells.values()) this.dispose(e);
    this.cells.clear();
    this.field = field;
    this.sheet = sheet;
    this.originZ = originZ;
  }

  private cellOf(z: number): number {
    return Math.floor((this.originZ - z - WORLD.thermalFirst) / WORLD.thermalCell);
  }

  private generate(cell: number): Thermal[] {
    const out: Thermal[] = [];
    const f = this.field;
    const zc = this.originZ - WORLD.thermalFirst - (cell + 0.5) * WORLD.thermalCell;
    const k = f.difficulty(zc);
    const make = (x: number, z: number, i: number): Thermal => {
      const radius = WORLD.thermalRadius * (0.8 + 0.4 * hash01(this.sheet, cell, 40 + i));
      return {
        x,
        z,
        ground: f.heightAt(x, z),
        radius,
        lift: WORLD.thermalLift * (0.85 + 0.3 * hash01(this.sheet, cell, 50 + i)),
        top: WORLD.thermalHeight * (0.75 + 0.25 * hash01(this.sheet, cell, 60 + i)),
        phase: hash01(this.sheet, cell, 70 + i) * 10,
      };
    };
    // One thermal in the valley (probability drops with difficulty).
    if (cell >= 0 && hash01(this.sheet, cell, 1) < 1 - 0.3 * k) {
      const z = zc + (hash01(this.sheet, cell, 2) - 0.5) * WORLD.thermalCell * 0.5;
      const x = f.valleyCenter(z) + (hash01(this.sheet, cell, 3) - 0.5) * 120;
      out.push(make(x, z, 0));
    }
    // A couple of thermals out over the ridges, for players who climb high.
    const extra = Math.floor(hash01(this.sheet, cell, 4) * 3);
    for (let i = 0; i < extra; i++) {
      const z = zc + (hash01(this.sheet, cell, 10 + i) - 0.5) * WORLD.thermalCell;
      const side = hash01(this.sheet, cell, 20 + i) < 0.5 ? -1 : 1;
      const x = f.valleyCenter(z) + side * (260 + hash01(this.sheet, cell, 30 + i) * 700);
      out.push(make(x, z, i + 1));
    }
    return out;
  }

  private createObject(t: Thermal): LineSegments {
    const mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uBase: { value: new Vector3(t.x, t.ground, t.z) },
        uRadius: { value: t.radius },
        uTop: { value: t.top },
        uPhase: { value: t.phase },
        uTime: shared.uTime,
        uInk: shared.uInk,
        uFogDist: shared.uFogDist,
        uOpacity: { value: 1 },
      },
    });
    const obj = new LineSegments(getRingGeometry(), mat);
    obj.frustumCulled = false;
    return obj;
  }

  private dispose(e: Entry): void {
    for (const o of e.objects) {
      this.group.remove(o);
      (o.material as ShaderMaterial).dispose();
    }
  }

  /** Keep cells around the viewer populated. */
  update(z: number): void {
    const c = this.cellOf(z);
    const keep = new Set<number>();
    for (let i = c - 1; i <= c + 3; i++) keep.add(i);
    for (const [cell, e] of this.cells) {
      if (!keep.has(cell)) {
        this.dispose(e);
        this.cells.delete(cell);
      }
    }
    for (const cell of keep) {
      if (this.cells.has(cell)) continue;
      const thermals = this.generate(cell);
      const objects = thermals.map((t) => this.createObject(t));
      objects.forEach((o) => this.group.add(o));
      this.cells.set(cell, { cell, thermals, objects });
    }
  }

  /** Vertical air speed (m/s) at a point. */
  liftAt(p: Vector3 | { x: number; y: number; z: number }): number {
    let lift = 0;
    for (const e of this.cells.values()) {
      for (const t of e.thermals) {
        const h = p.y - t.ground;
        if (h < 0 || h > t.top) continue;
        const r = t.radius * (0.62 + 0.38 * smoothstep(0, t.top * 0.45, h));
        const dx = p.x - t.x;
        const dz = p.z - t.z;
        const d2 = (dx * dx + dz * dz) / (r * r);
        if (d2 > 4) continue;
        const topFade = 1 - smoothstep(t.top * 0.6, t.top, h);
        lift += t.lift * Math.exp(-d2 * 1.6) * topFade;
      }
    }
    return lift;
  }

  /** All currently generated thermals (for the radar). */
  *all(): Iterable<Thermal> {
    for (const e of this.cells.values()) yield* e.thermals;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
