import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { BALL } from '../config';
import type { HeightField } from '../field/heightfield';
import { shared } from './uniforms';

const LIFT = 0.12;

/** A polyline draped over the terrain. */
class Drape {
  readonly line: Line;
  private readonly pos: Float32Array;

  constructor(
    private readonly max: number,
    material: LineBasicMaterial | LineDashedMaterial,
  ) {
    this.pos = new Float32Array(max * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setDrawRange(0, 0);
    this.line = new Line(g, material);
    this.line.frustumCulled = false;
  }

  set(points: ReadonlyArray<readonly [number, number]>, field: HeightField, lift = LIFT): void {
    const n = Math.min(points.length, this.max);
    for (let i = 0; i < n; i++) {
      const [x, z] = points[i];
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = field.heightAt(x, z) + lift;
      this.pos[i * 3 + 2] = z;
    }
    const g = this.line.geometry;
    g.attributes.position.needsUpdate = true;
    g.setDrawRange(0, n);
    if (this.line.material instanceof LineDashedMaterial) this.line.computeLineDistances();
  }
}

function ring(segments: number, radius = 1): BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
}

const ballVert = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ballFrag = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uBg;
varying vec3 vN;
void main() {
  float l = clamp(dot(vN, normalize(vec3(-0.4, 0.8, 0.5))), 0.0, 1.0);
  float rim = pow(1.0 - abs(vN.z), 3.0);
  vec3 c = mix(mix(uBg, uInk, 0.55), uInk, l);
  c = mix(c, uBg, rim * 0.5);
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Ball, its trail and preview, the goal, benchmarks and the brush ring. */
export class Markers {
  readonly group = new Group();
  readonly ball: Mesh;
  private readonly trail: Drape;
  private readonly preview: Drape;
  private readonly goal = new Group();
  private readonly goalRings: LineLoop[] = [];
  private readonly pole: LineSegments;
  private checkpoints: Group[] = [];
  private readonly brush = new Group();
  private readonly brushOuter: LineLoop;
  private readonly brushInner: LineLoop;
  private readonly brushPos: Float32Array;
  private readonly lineMats: Array<LineBasicMaterial | LineDashedMaterial> = [];

  constructor() {
    this.ball = new Mesh(
      new SphereGeometry(BALL.radius * 1.35, 32, 20),
      new ShaderMaterial({ vertexShader: ballVert, fragmentShader: ballFrag, uniforms: { uInk: shared.uInk, uBg: shared.uBg } }),
    );

    const trailMat = this.mat(new LineBasicMaterial({ transparent: true, opacity: 0.8 }));
    this.trail = new Drape(4000, trailMat);
    const prevMat = this.mat(new LineDashedMaterial({ dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 1 }));
    this.preview = new Drape(400, prevMat);

    for (let i = 0; i < 4; i++) {
      const r = new LineLoop(ring(64), this.mat(new LineBasicMaterial({ transparent: true })));
      this.goalRings.push(r);
      this.goal.add(r);
    }
    const poleGeo = new BufferGeometry().setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 0, 7, 0, 0, 7, 0, 2.2, 6.2, 0, 2.2, 6.2, 0, 0, 5.4, 0]), 3),
    );
    this.pole = new LineSegments(poleGeo, this.mat(new LineBasicMaterial({ transparent: true, opacity: 0.9 })));
    this.goal.add(this.pole);

    const segs = 96;
    this.brushPos = new Float32Array(segs * 3);
    const bg = new BufferGeometry().setAttribute('position', new BufferAttribute(this.brushPos, 3));
    this.brushOuter = new LineLoop(bg, this.mat(new LineDashedMaterial({ dashSize: 0.6, gapSize: 0.45, transparent: true, depthTest: false })));
    this.brushInner = new LineLoop(ring(24, 0.5), this.mat(new LineBasicMaterial({ transparent: true, depthTest: false })));
    this.brushOuter.frustumCulled = false;
    this.brushOuter.renderOrder = 5;
    this.brushInner.renderOrder = 5;
    this.brush.add(this.brushOuter, this.brushInner);
    this.brush.visible = false;

    this.group.add(this.ball, this.trail.line, this.preview.line, this.goal, this.brush);
  }

  private mat<T extends LineBasicMaterial | LineDashedMaterial>(m: T): T {
    m.color.copy(shared.uInk.value);
    this.lineMats.push(m);
    return m;
  }

  syncColors(): void {
    for (const m of this.lineMats) m.color.copy(shared.uInk.value);
  }

  setCourse(goal: readonly [number, number], checkpoints: ReadonlyArray<readonly [number, number]>, field: HeightField): void {
    this.goal.position.set(goal[0], field.heightAt(goal[0], goal[1]) + 0.05, goal[1]);
    for (const c of this.checkpoints) this.group.remove(c);
    this.checkpoints = checkpoints.map(([x, z]) => {
      const g = new Group();
      const y = field.heightAt(x, z);
      const tri = new BufferGeometry().setAttribute(
        'position',
        new BufferAttribute(new Float32Array([-1.3, 3.2, 0, 1.3, 3.2, 0, 1.3, 3.2, 0, 0, 5.5, 0, 0, 5.5, 0, -1.3, 3.2, 0, 0, 0, 0, 0, 3.2, 0]), 3),
      );
      const mark = new LineSegments(tri, this.mat(new LineBasicMaterial({ transparent: true })));
      const circle = new LineLoop(ring(48, BALL.checkpointRadius), this.mat(new LineDashedMaterial({ dashSize: 0.5, gapSize: 0.4, transparent: true })));
      circle.computeLineDistances();
      circle.position.y = 0.15;
      g.add(mark, circle);
      g.position.set(x, y, z);
      g.userData.mark = mark;
      this.group.add(g);
      return g;
    });
  }

  setBall(x: number, y: number, z: number, vx = 0, vz = 0, dt = 0): void {
    this.ball.position.set(x, y + BALL.radius * 1.25, z);
    // roll the sphere with its motion
    const sp = Math.hypot(vx, vz);
    if (sp > 1e-4 && dt > 0) {
      const axis = new Vector3(vz / sp, 0, -vx / sp);
      this.ball.rotateOnWorldAxis(axis, (sp * dt) / (BALL.radius * 1.35));
    }
  }

  setTrail(points: ReadonlyArray<readonly [number, number]>, field: HeightField): void {
    this.trail.set(points, field, 0.1);
  }

  setPreview(points: ReadonlyArray<readonly [number, number]>, field: HeightField, visible: boolean): void {
    this.preview.line.visible = visible;
    if (visible) this.preview.set(points, field, 0.25);
  }

  /** Brush ring draped on the ground; dashed for cutting, solid for raising. */
  setBrush(x: number, z: number, radius: number, mode: 'raise' | 'cut', field: HeightField, visible: boolean, time: number): void {
    this.brush.visible = visible;
    if (!visible) return;
    const n = this.brushPos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + time * 0.3;
      const px = x + Math.cos(a) * radius;
      const pz = z + Math.sin(a) * radius;
      this.brushPos[i * 3] = px;
      this.brushPos[i * 3 + 1] = field.heightAt(px, pz) + 0.2;
      this.brushPos[i * 3 + 2] = pz;
    }
    this.brushOuter.geometry.attributes.position.needsUpdate = true;
    this.brushOuter.computeLineDistances();
    const outer = this.brushOuter.material as LineDashedMaterial;
    outer.gapSize = mode === 'cut' ? 0.9 : 0.001;
    outer.dashSize = mode === 'cut' ? 0.6 : 1;
    this.brushInner.position.set(x, field.heightAt(x, z) + 0.2, z);
  }

  update(time: number, reached: boolean[], holed: number): void {
    // goal: rings rising out of the cup
    this.goalRings.forEach((r, i) => {
      const t = (time * 0.35 + i / this.goalRings.length) % 1;
      const burst = holed > 0 ? Math.min(holed / 1.2, 1) : 0;
      r.position.y = t * 4 + burst * 3;
      r.scale.setScalar(1.2 + t * 1.6 + burst * 6 * (1 - t * 0.3));
      (r.material as LineBasicMaterial).opacity = (1 - t) * 0.8 * (1 - burst);
    });
    (this.pole.material as LineBasicMaterial).opacity = holed > 0 ? Math.max(0, 1 - holed) : 0.9;
    this.checkpoints.forEach((g, i) => {
      const mark = g.userData.mark as LineSegments;
      const m = mark.material as LineBasicMaterial;
      m.opacity = reached[i] ? 1 : 0.55 + 0.3 * Math.sin(time * 4);
      mark.scale.setScalar(reached[i] ? 1.15 : 1);
      mark.rotation.y = time * 0.8;
    });
  }
}
