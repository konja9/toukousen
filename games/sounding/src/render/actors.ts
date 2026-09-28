import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  WireframeGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RUN } from '../config';
import { floorAt } from '../field/grid';
import type { World } from '../sim/world';
import { shared } from './uniforms';

/** Line-drawn models: the sub, contacts, mines, survey marks, the exit, weapons, marine snow, the surface. */

type Seg = number[];

function segs(list: Seg): BufferGeometry {
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(list), 3));
}

/** A submarine pointing along -z, `L` long. */
function subGeometry(L = 14, R = 1.7): BufferGeometry {
  const out: Seg = [];
  const r = (u: number) => R * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 2.6)));
  const pt = (u: number, a: number): [number, number, number] => [Math.cos(a) * r(u), Math.sin(a) * r(u), (u * L) / 2];
  // a few rings: bow, amidships, stern
  for (const u of [-0.62, 0, 0.62]) {
    for (let s = 0; s < 20; s++) out.push(...pt(u, (s / 20) * Math.PI * 2), ...pt(u, ((s + 1) / 20) * Math.PI * 2));
  }
  // lengthwise lines
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (let s = 0; s < 20; s++) out.push(...pt(-1 + s / 10, ang), ...pt(-1 + (s + 1) / 10, ang));
  }
  // sail
  const z0 = -L * 0.22;
  const z1 = -L * 0.04;
  const top = R + 1.5;
  const w = 0.35;
  for (const x of [-w, w]) out.push(x, R * 0.9, z0, x, top, z0 + 0.3, x, top, z0 + 0.3, x, top, z1, x, top, z1, x, R * 0.9, z1);
  out.push(-w, top, z0 + 0.3, w, top, z0 + 0.3, -w, top, z1, w, top, z1);
  // planes and rudder at the stern, fairwater planes on the sail
  const zs = L * 0.42;
  out.push(-2.2, 0, zs, 2.2, 0, zs, 0, -2.2, zs, 0, 2.2, zs);
  out.push(-1.4, top - 0.6, (z0 + z1) / 2, 1.4, top - 0.6, (z0 + z1) / 2);
  return segs(out);
}

/** A surface ship seen from below: hull outline at the waterline, keel, a mast. */
function shipGeometry(L = 38, B = 7): BufferGeometry {
  const out: Seg = [];
  const hull: Array<[number, number]> = [
    [0, -L / 2],
    [B / 2, -L * 0.22],
    [B / 2, L * 0.4],
    [B * 0.35, L / 2],
    [-B * 0.35, L / 2],
    [-B / 2, L * 0.4],
    [-B / 2, -L * 0.22],
  ];
  for (let i = 0; i < hull.length; i++) {
    const [x0, z0] = hull[i];
    const [x1, z1] = hull[(i + 1) % hull.length];
    out.push(x0, 0, z0, x1, 0, z1);
    out.push(x0 * 0.7, -2.5, z0 * 0.96, x1 * 0.7, -2.5, z1 * 0.96);
    out.push(x0, 0, z0, x0 * 0.7, -2.5, z0 * 0.96);
  }
  out.push(0, -3, -L * 0.45, 0, -3, L * 0.45);
  // sonar dome
  for (let s = 0; s < 12; s++) {
    const a0 = (s / 12) * Math.PI * 2;
    const a1 = ((s + 1) / 12) * Math.PI * 2;
    out.push(Math.cos(a0) * 1.2, -4, -L * 0.36 + Math.sin(a0) * 1.2, Math.cos(a1) * 1.2, -4, -L * 0.36 + Math.sin(a1) * 1.2);
  }
  // superstructure and mast above the water
  out.push(-2, 0, -4, -2, 4, -4, 2, 0, -4, 2, 4, -4, -2, 4, -4, 2, 4, -4, 0, 4, -4, 0, 11, -2);
  return segs(out);
}

function buoyGeometry(): BufferGeometry {
  const out: Seg = [0, -3, 0, 0, 3, 0];
  for (let s = 0; s < 12; s++) {
    const a0 = (s / 12) * Math.PI * 2;
    const a1 = ((s + 1) / 12) * Math.PI * 2;
    out.push(Math.cos(a0) * 1.4, 0, Math.sin(a0) * 1.4, Math.cos(a1) * 1.4, 0, Math.sin(a1) * 1.4);
  }
  return segs(out);
}

function circleGeometry(r: number, n = 48, dashes = false): BufferGeometry {
  const out: Seg = [];
  for (let s = 0; s < n; s++) {
    if (dashes && s % 2) continue;
    const a0 = (s / n) * Math.PI * 2;
    const a1 = ((s + 1) / n) * Math.PI * 2;
    out.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
  }
  return segs(out);
}

const SNOW = 1600;
const SNOW_BOX = 90;

export interface Label {
  x: number;
  y: number;
  z: number;
  text: string;
  sub?: string;
  alpha: number;
}

export class Actors {
  readonly group = new Group();
  private readonly mats: Array<LineBasicMaterial | LineDashedMaterial | PointsMaterial> = [];
  private readonly sub: LineSegments;
  private readonly contactPool: LineSegments[] = [];
  private readonly minePool: Group[] = [];
  private readonly surveyPool: Group[] = [];
  private readonly exit: Group;
  private readonly weapons: Points;
  private readonly snow: Points;
  private readonly surface: Mesh;
  private readonly shipGeo = shipGeometry();
  private readonly subGeo = subGeometry();
  private readonly buoyGeo = buoyGeometry();
  labels: Label[] = [];

  constructor() {
    this.sub = new LineSegments(this.subGeo, this.line(0.95));
    this.group.add(this.sub);

    this.exit = new Group();
    const ring = new LineSegments(circleGeometry(RUN.exitRadius, 64, true), this.line(0.9));
    const inner = new LineSegments(circleGeometry(RUN.exitRadius * 0.6, 48, true), this.line(0.5));
    inner.position.y = -14;
    const drops: Seg = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = Math.cos(a) * RUN.exitRadius;
      const z = Math.sin(a) * RUN.exitRadius;
      for (let d = 0; d < 30; d += 6) drops.push(x * (1 - d / 80), -d, z * (1 - d / 80), x * (1 - (d + 3) / 80), -d - 3, z * (1 - (d + 3) / 80));
    }
    this.exit.add(ring, inner, new LineSegments(segs(drops), this.line(0.45)));
    this.group.add(this.exit);

    const wg = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(64 * 3), 3));
    const wm = new PointsMaterial({ size: 5, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false });
    this.mats.push(wm);
    this.weapons = new Points(wg, wm);
    this.weapons.frustumCulled = false;
    this.group.add(this.weapons);

    // marine snow: drifting motes that wrap around the camera
    const sp = new Float32Array(SNOW * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * SNOW_BOX;
    const sg = new BufferGeometry().setAttribute('position', new BufferAttribute(sp, 3));
    this.snow = new Points(
      sg,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uInk: shared.uInk, uTime: shared.uTime, uBox: { value: SNOW_BOX } },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uBox;
          varying float vA;
          void main() {
            vec3 p = position;
            p.y -= uTime * 0.25;
            p.x += sin(uTime * 0.2 + position.y) * 0.6;
            vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
            vec3 w = cameraPosition + rel;
            vec4 mv = viewMatrix * vec4(w, 1.0);
            float d = -mv.z;
            vA = (1.0 - smoothstep(uBox * 0.25, uBox * 0.5, length(rel))) * smoothstep(1.0, 4.0, d);
            gl_PointSize = clamp(40.0 / d, 1.0, 3.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          varying float vA;
          void main() { gl_FragColor = vec4(uInk, vA * 0.35); }`,
      }),
    );
    this.snow.frustumCulled = false;
    this.group.add(this.snow);

    // the surface seen from below: a faint grid that fades with distance
    this.surface = new Mesh(
      new PlaneGeometry(600, 600, 1, 1).rotateX(Math.PI / 2),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uInk: shared.uInk, uTime: shared.uTime },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          uniform float uTime;
          varying vec3 vW;
          float grid(float v) { float fw = fwidth(v); return 1.0 - smoothstep(0.0, fw * 1.2, abs(fract(v - 0.5) - 0.5)); }
          void main() {
            vec2 p = vW.xz + vec2(sin(uTime * 0.3 + vW.z * 0.05), cos(uTime * 0.25 + vW.x * 0.05)) * 1.5;
            float g = max(grid(p.x / 25.0), grid(p.y / 25.0));
            float d = distance(vW, cameraPosition);
            float a = g * 0.22 * exp(-pow(d / 170.0, 2.0));
            gl_FragColor = vec4(uInk, a);
          }`,
      }),
    );
    this.surface.frustumCulled = false;
    this.group.add(this.surface);
  }

  private line(opacity: number, dashed = false): LineBasicMaterial | LineDashedMaterial {
    const m = dashed
      ? new LineDashedMaterial({ transparent: true, opacity, dashSize: 1.2, gapSize: 1.0, depthWrite: false })
      : new LineBasicMaterial({ transparent: true, opacity, depthWrite: false });
    m.color.copy(shared.uInk.value);
    this.mats.push(m);
    return m;
  }

  syncColors(): void {
    for (const m of this.mats) m.color.copy(shared.uInk.value);
  }

  private pooled<T extends Object3D>(pool: T[], i: number, make: () => T): T {
    while (pool.length <= i) {
      const o = make();
      pool.push(o);
      this.group.add(o);
    }
    return pool[i];
  }

  update(w: World, cam: { x: number; y: number; z: number }, showSub: boolean): void {
    const now = w.t;
    const fade = w.fade;
    const lit = (t: number) => (t < -1e8 ? 0 : Math.exp(-Math.max(0, now - t) / fade));
    const prox = (x: number, y: number, z: number, r: number) => Math.max(0, 1 - Math.hypot(x - w.sub.x, y - w.sub.y, z - w.sub.z) / r);
    this.labels = [];

    const s = w.sub;
    this.sub.visible = showSub;
    this.sub.position.set(s.x, s.y, s.z);
    this.sub.rotation.set(0, -s.heading, 0);
    this.sub.rotation.x = Math.max(-0.35, Math.min(0.35, s.vy * 0.08));

    // contacts
    w.contacts.forEach((k, i) => {
      const o = this.pooled(this.contactPool, i, () => new LineSegments(this.shipGeo, this.line(0.8)));
      o.geometry = k.kind === 'ship' ? this.shipGeo : k.kind === 'hunter' ? this.subGeo : this.buoyGeo;
      o.position.set(k.x, k.kind === 'ship' ? 0 : k.y, k.z);
      o.rotation.set(0, -k.heading, 0);
      const d = Math.hypot(k.x - cam.x, k.y - cam.y, k.z - cam.z);
      let a: number;
      if (k.kind === 'ship') a = 0.75 * Math.exp(-Math.pow(d / 240, 2));
      else {
        // subs and buoys only show up close, or right after they ping
        const pinged = w.pings.some((p) => p.contact === k && now - p.ping.t0 < 2);
        a = Math.max(prox(k.x, k.y, k.z, 55), pinged ? 0.9 : 0, k.kind === 'buoy' ? 0.35 * Math.exp(-Math.pow(d / 120, 2)) : 0);
      }
      (o.material as LineBasicMaterial).opacity = a;
      o.visible = a > 0.01;
      o.scale.setScalar(k.kind === 'hunter' ? 1.15 : 1);
    });
    for (let i = w.contacts.length; i < this.contactPool.length; i++) this.contactPool[i].visible = false;

    // mines: lit by our pings, or close
    w.mines.forEach((m, i) => {
      const g = this.pooled(this.minePool, i, () => {
        const grp = new Group();
        grp.add(new LineSegments(new WireframeGeometry(new IcosahedronGeometry(1.6, 0)), this.line(1)));
        grp.add(new LineSegments(segs([0, 0, 0, 0, -1, 0]), this.line(0.5)));
        return grp;
      });
      const a = m.alive ? Math.max(lit(m.litAt), m.litAt > -1e8 ? 0.22 : 0, prox(m.x, m.y, m.z, 30)) : 0;
      g.visible = a > 0.01;
      g.position.set(m.x, m.y, m.z);
      const floorY = floorAt(w.floor, m.x, m.z);
      const tether = g.children[1] as LineSegments;
      tether.scale.y = Math.max(0.1, m.y - floorY);
      g.children.forEach((c) => (((c as LineSegments).material as Material).opacity = a));
      if (a > 0.15) this.labels.push({ x: m.x, y: m.y + 4, z: m.z, text: '機雷', sub: 'MINE', alpha: a });
    });
    for (let i = w.mines.length; i < this.minePool.length; i++) this.minePool[i].visible = false;

    // survey targets
    w.surveys.forEach((v, i) => {
      const g = this.pooled(this.surveyPool, i, () => {
        const grp = new Group();
        grp.add(new LineSegments(new WireframeGeometry(new OctahedronGeometry(2.4, 0)), this.line(1)));
        grp.add(new LineSegments(segs([0, 2.4, 0, 0, 10, 0]), this.line(0.6)));
        return grp;
      });
      const a = Math.max(lit(v.litAt), v.found ? 0.3 : 0, prox(v.x, v.y, v.z, 30));
      g.visible = a > 0.01;
      g.position.set(v.x, v.y + 2, v.z);
      g.children[0].rotation.y = now * 0.6;
      g.children.forEach((c) => (((c as LineSegments).material as Material).opacity = a));
      const name = v.kind === 'wreck' ? '沈没船' : v.kind === 'vent' ? '熱水噴出孔' : '海山頂';
      if (a > 0.15) this.labels.push({ x: v.x, y: v.y + 14, z: v.z, text: `測点 · ${name}`, sub: v.found ? 'RECORDED' : 'SURVEY', alpha: a });
    });
    for (let i = w.surveys.length; i < this.surveyPool.length; i++) this.surveyPool[i].visible = false;

    // exit trench
    const [ex, ez] = w.sector.exit;
    const exitY = w.layerY - 45;
    const ea = Math.max(lit(w.exitLitAt), w.exitLitAt > -1e8 ? 0.45 : 0, prox(ex, exitY, ez, 60));
    this.exit.visible = ea > 0.01;
    this.exit.position.set(ex, exitY, ez);
    this.exit.rotation.y = now * 0.1;
    this.exit.children.forEach((c) => (((c as LineSegments).material as Material).opacity = ea));
    if (ea > 0.15) this.labels.push({ x: ex, y: exitY + 8, z: ez, text: '降下口 ▼', sub: 'DESCENT', alpha: ea });

    // weapons and decoys
    const pos = this.weapons.geometry.attributes.position as BufferAttribute;
    let n = 0;
    for (const wp of w.weapons) if (n < 60) pos.setXYZ(n++, wp.x, wp.y, wp.z);
    for (const d of w.decoys) if (n < 64 && now <= d.until) pos.setXYZ(n++, d.x, d.y, d.z);
    pos.needsUpdate = true;
    this.weapons.geometry.setDrawRange(0, n);
    this.weapons.visible = n > 0;
    if (w.weapons.some((wp) => wp.kind === 'charge')) this.labels.push({ ...w.weapons.find((wp) => wp.kind === 'charge')!, text: '爆雷', sub: 'DEPTH CHARGE', alpha: 0.9 });
    const torp = w.weapons.find((wp) => wp.kind === 'torpedo');
    if (torp) this.labels.push({ x: torp.x, y: torp.y + 3, z: torp.z, text: '魚雷', sub: 'TORPEDO', alpha: 0.9 });
  }

  setSurfaceVisible(v: boolean): void {
    this.surface.visible = v;
  }
}
