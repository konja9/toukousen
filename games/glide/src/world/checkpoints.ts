import { BufferAttribute, BufferGeometry, Group, LineSegments, ShaderMaterial } from 'three';
import { RUN, TERRAIN } from '../config';
import { shared } from './uniforms';
import type { TerrainField } from './terrainField';

/**
 * Checkpoints: a curtain of level lines hung across the valley every sector
 * length — contour lines of a wall of air. Only the parts above the ground are
 * drawn. Crossing is decided by the run clock (by progress); this only shows it.
 */

const LEVEL_STEP = 8;
const LEVELS = 30;
const SAMPLE = 5;

const vertexShader = /* glsl */ `
attribute float aLevel;
uniform float uTime;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float k = aLevel / ${LEVELS.toFixed(1)};
  // a brighter band climbing the curtain
  float scan = exp(-pow(fract(k - uTime * 0.35) * 7.0 - 0.5, 2.0));
  vAlpha = pow(1.0 - k, 1.3) * (0.55 + 0.45 * scan);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
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
  gl_FragColor = vec4(uInk, vAlpha * fog * uOpacity);
}
`;

interface Curtain {
  index: number;
  obj: LineSegments<BufferGeometry, ShaderMaterial>;
  passed: boolean;
  age: number;
}

export class Checkpoints {
  readonly group = new Group();
  private readonly items: Curtain[] = [];
  private field!: TerrainField;
  private originZ = 0;

  reset(field: TerrainField, originZ: number): void {
    for (const c of this.items) this.dispose(c);
    this.items.length = 0;
    this.field = field;
    this.originZ = originZ;
  }

  /** z of checkpoint `index` (1 = the end of the first sector). */
  zOf(index: number): number {
    return this.originZ - index * RUN.sectorLength;
  }

  private build(index: number): BufferGeometry {
    const f = this.field;
    const z = this.zOf(index);
    const cx = f.valleyCenter(z);
    const k = f.difficulty(z);
    const halfW = TERRAIN.halfWidth0 + (TERRAIN.halfWidth1 - TERRAIN.halfWidth0) * k;
    const span = halfW * 3.2;
    const n = Math.ceil((span * 2) / SAMPLE);
    const ground: number[] = [];
    for (let i = 0; i <= n; i++) ground.push(f.heightAt(cx - span + i * SAMPLE, z));
    const floor = f.heightAt(cx, z);
    const pos: number[] = [];
    const lvl: number[] = [];
    for (let l = 0; l < LEVELS; l++) {
      const y = floor + 3 + l * LEVEL_STEP;
      for (let i = 0; i < n; i++) {
        if (ground[i] > y - 0.5 || ground[i + 1] > y - 0.5) continue;
        pos.push(cx - span + i * SAMPLE, y, z, cx - span + (i + 1) * SAMPLE, y, z);
        lvl.push(l, l);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aLevel', new BufferAttribute(new Float32Array(lvl), 1));
    return geo;
  }

  private create(index: number): Curtain {
    const mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uInk: shared.uInk,
        uFogDist: shared.uFogDist,
        uTime: shared.uTime,
        uOpacity: { value: 0.6 },
      },
    });
    const obj = new LineSegments(this.build(index), mat);
    obj.frustumCulled = false;
    this.group.add(obj);
    return { index, obj, passed: false, age: 0 };
  }

  private dispose(c: Curtain): void {
    this.group.remove(c.obj);
    c.obj.geometry.dispose();
    c.obj.material.dispose();
  }

  /** Keep the next checkpoint's curtain up; `passed` is the number of checkpoints crossed. */
  update(passed: number, dt: number): void {
    const next = passed + 1;
    if (!this.items.some((c) => c.index === next)) this.items.push(this.create(next));
    for (const c of this.items) {
      if (c.index <= passed && !c.passed) {
        c.passed = true;
        c.age = 0;
      }
      c.age += dt;
      // a flash when crossed, then gone
      c.obj.material.uniforms.uOpacity.value = c.passed ? 1.8 * Math.max(0, 1 - c.age / 1.4) : 0.6;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const c = this.items[i];
      if (c.passed && c.age > 1.4) {
        this.dispose(c);
        this.items.splice(i, 1);
      }
    }
  }
}
