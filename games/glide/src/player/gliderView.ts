import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { shared } from '../world/uniforms';
import type { Glider } from './glider';

// Local frame: forward = -Z, up = +Y, right = +X. Units: meters.
const NOSE = [0, 0, -2.4];
const TIP_L = [-3.3, 0, 1.0];
const TIP_R = [3.3, 0, 1.0];
const TAIL = [0, 0, 0.55];
const FIN_TOP = [0, 0.85, 1.15];
const FIN_BACK = [0, 0, 1.15];

const OUTLINE: number[][][] = [
  [NOSE, TIP_L],
  [TIP_L, TAIL],
  [TAIL, TIP_R],
  [TIP_R, NOSE],
  [NOSE, TAIL],
  [TAIL, FIN_TOP],
  [FIN_TOP, FIN_BACK],
  [TAIL, FIN_BACK],
];

const TRAIL_POINTS = 22;

class Trail {
  readonly line: Line;
  private readonly pos = new Float32Array(TRAIL_POINTS * 3);
  private readonly col = new Float32Array(TRAIL_POINTS * 4);
  private count = 0;

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 4));
    geo.setDrawRange(0, 0);
    const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true });
    this.line = new Line(geo, mat);
    this.line.frustumCulled = false;
  }

  clear(): void {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  push(p: Vector3): void {
    this.pos.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
    this.pos[0] = p.x;
    this.pos[1] = p.y;
    this.pos[2] = p.z;
    this.count = Math.min(this.count + 1, TRAIL_POINTS);
    this.refreshColors();
  }

  /** Keep the newest point glued to the wingtip between samples. */
  head(p: Vector3): void {
    if (!this.count) return;
    this.pos[0] = p.x;
    this.pos[1] = p.y;
    this.pos[2] = p.z;
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  /** 0..1 visibility, driven by how hard the glider is working. */
  strength = 0.3;

  refreshColors(): void {
    const ink = shared.uInk.value;
    for (let i = 0; i < this.count; i++) {
      const a = Math.pow(1 - i / TRAIL_POINTS, 1.4) * this.strength;
      this.col.set([ink.r, ink.g, ink.b, a], i * 4);
    }
    const g = this.line.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.count);
  }
}

interface Shard {
  a: Vector3;
  b: Vector3;
  v: Vector3;
  spin: Vector3;
}

/** Line-art glider, wingtip vortex trails and the shatter-on-impact effect. */
export class GliderView {
  readonly root = new Group();
  readonly model = new Group();
  private readonly outline: LineSegments;
  private readonly fill: Mesh;
  private readonly trails = [new Trail(), new Trail()];
  private readonly tipL = new Vector3(...TIP_L);
  private readonly tipR = new Vector3(...TIP_R);
  private trailTimer = 0;

  private readonly shardGeo = new BufferGeometry();
  private readonly shardLines: LineSegments;
  private shards: Shard[] = [];
  private shardAge = 0;

  constructor() {
    const pts = OUTLINE.flatMap(([a, b]) => [...a, ...b]);
    const lineMat = new LineBasicMaterial({ color: shared.uInk.value });
    this.outline = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)), lineMat);

    // Background-colored fill hides the contour lines behind the wing.
    const fillGeo = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute([...NOSE, ...TIP_L, ...TAIL, ...NOSE, ...TAIL, ...TIP_R, ...TAIL, ...FIN_TOP, ...FIN_BACK], 3),
    );
    this.fill = new Mesh(fillGeo, new MeshBasicMaterial({ color: shared.uBg.value, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));

    this.model.add(this.fill, this.outline);
    this.model.rotation.order = 'YXZ';
    this.root.add(this.model);
    for (const t of this.trails) this.root.add(t.line);

    this.shardGeo.setAttribute('position', new BufferAttribute(new Float32Array(OUTLINE.length * 2 * 3), 3));
    this.shardLines = new LineSegments(this.shardGeo, new LineBasicMaterial({ color: shared.uInk.value, transparent: true }));
    this.shardLines.frustumCulled = false;
    this.shardLines.visible = false;
    this.root.add(this.shardLines);
  }

  reset(): void {
    this.model.visible = true;
    this.shardLines.visible = false;
    this.trails.forEach((t) => t.clear());
    this.trailTimer = 0;
  }

  update(g: Glider, dt: number): void {
    this.model.position.set(g.x, g.y, g.z);
    this.model.rotation.set(g.pitch, -g.yaw, -g.bank);
    this.model.updateMatrixWorld();
    const l = this.tipL.set(TIP_L[0], TIP_L[1], TIP_L[2]).applyMatrix4(this.model.matrixWorld);
    const r = this.tipR.set(TIP_R[0], TIP_R[1], TIP_R[2]).applyMatrix4(this.model.matrixWorld);
    const load = Math.min(1, Math.abs(g.bank) / 0.8 + Math.max(0, (g.speed - 60) / 40) + Math.abs(g.pitch) * 0.8);
    for (const t of this.trails) t.strength += (0.12 + 0.6 * load - t.strength) * Math.min(1, dt * 4);
    this.trailTimer += dt;
    if (this.trailTimer > 1 / 36) {
      this.trailTimer = 0;
      this.trails[0].push(l);
      this.trails[1].push(r);
    } else {
      this.trails[0].head(l);
      this.trails[1].head(r);
    }
  }

  /** Break the outline into independent segments flying apart. */
  shatter(g: Glider): void {
    this.model.updateMatrixWorld();
    const m = this.model.matrixWorld;
    const vel = new Vector3(g.vx, Math.max(g.vy, 0) + 6, g.vz).multiplyScalar(0.35);
    this.shards = OUTLINE.map(([a, b]) => {
      const pa = new Vector3(a[0], a[1], a[2]).applyMatrix4(m);
      const pb = new Vector3(b[0], b[1], b[2]).applyMatrix4(m);
      const v = vel.clone().add(new Vector3((Math.random() - 0.5) * 18, Math.random() * 12, (Math.random() - 0.5) * 18));
      const spin = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9);
      return { a: pa, b: pb, v, spin };
    });
    this.shardAge = 0;
    this.model.visible = false;
    this.shardLines.visible = true;
  }

  updateShards(dt: number): void {
    if (!this.shardLines.visible) return;
    this.shardAge += dt;
    const arr = this.shardGeo.attributes.position.array as Float32Array;
    const mid = new Vector3();
    const half = new Vector3();
    this.shards.forEach((s, i) => {
      s.v.y -= 9.81 * dt;
      s.v.multiplyScalar(Math.exp(-1.2 * dt));
      mid.addVectors(s.a, s.b).multiplyScalar(0.5).addScaledVector(s.v, dt);
      half.subVectors(s.b, s.a).multiplyScalar(0.5);
      half.applyAxisAngle(s.spin.clone().normalize(), s.spin.length() * dt);
      s.a.copy(mid).sub(half);
      s.b.copy(mid).add(half);
      arr.set([s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z], i * 6);
    });
    this.shardGeo.attributes.position.needsUpdate = true;
    (this.shardLines.material as LineBasicMaterial).opacity = Math.max(0, 1 - this.shardAge / 2.5);
  }

  setColors(): void {
    (this.outline.material as LineBasicMaterial).color.copy(shared.uInk.value);
    (this.shardLines.material as LineBasicMaterial).color.copy(shared.uInk.value);
    (this.fill.material as MeshBasicMaterial).color.copy(shared.uBg.value);
    this.trails.forEach((t) => t.refreshColors());
  }
}
