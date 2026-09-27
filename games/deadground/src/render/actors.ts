import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  type Material,
} from 'three';
import { PLAYER, WATCH } from '../config';
import type { HeightField } from '../field/heightfield';
import type { Course } from '../sim/course';
import type { Player } from '../sim/player';
import type { WatcherDef, WatcherState } from '../sim/watchers';
import { shared } from './uniforms';

const segs = (pts: number[]) => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));

function circle(r: number, n = 48, y = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
  }
  return out;
}

function label(text: string, ink: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = ink;
  g.font = "300 84px 'Inter', system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Line-art figures in the world: surveyor, towers with beams, patrols, flags. */
export class Actors {
  readonly group = new Group();
  private readonly lineMats: LineBasicMaterial[] = [];
  private readonly fillMats: MeshBasicMaterial[] = [];
  private readonly player = new Group();
  private readonly body: LineSegments;
  private watchers: Array<{ def: WatcherDef; root: Group; beam: Mesh; beamEdges: LineSegments }> = [];
  private flags: Array<{ root: Group; ring: LineLoop; sprite: Sprite }> = [];
  private readonly course = new Group();

  constructor() {
    this.body = new LineSegments(segs([]), this.line(1));
    const head = new LineLoop(segs(circle(0.22, 20).slice(0, 60)), this.line(1));
    head.name = 'head';
    const arrow = new LineSegments(segs([0, 0.05, -1.1, 0.35, 0.05, -0.5, 0, 0.05, -1.1, -0.35, 0.05, -0.5]), this.line(0.9));
    arrow.name = 'arrow';
    const ringG = new LineLoop(segs(circle(0.5, 24).filter((_, i) => i % 6 < 3)), this.line(0.5));
    this.player.add(this.body, head, arrow, ringG);
    this.group.add(this.player, this.course);
  }

  private line(opacity: number): LineBasicMaterial {
    const m = new LineBasicMaterial({ color: shared.uInk.value, transparent: true, opacity, fog: false });
    this.lineMats.push(m);
    return m;
  }

  syncColors(): void {
    for (const m of this.lineMats) m.color.copy(shared.uInk.value);
    for (const m of this.fillMats) m.color.copy(shared.uInk.value);
  }

  setCourse(course: Course, field: HeightField, ink: string): void {
    this.course.clear();
    for (const w of this.watchers) this.group.remove(w.root);
    this.watchers = [];
    this.flags = [];

    // start triangle and finish rings, drawn on the ground
    const [sx, sz] = course.start;
    const tri = new LineLoop(segs([0, 0, -3.2, 2.8, 0, 1.6, 2.8, 0, 1.6, -2.8, 0, 1.6, -2.8, 0, 1.6, 0, 0, -3.2]), this.line(0.95));
    tri.position.set(sx, field.heightAt(sx, sz) + 0.15, sz);
    this.course.add(tri);
    const [fx, fz] = course.finish;
    const fin = new LineSegments(segs([...circle(2.2), ...circle(3.4)]), this.line(0.95));
    fin.position.set(fx, field.heightAt(fx, fz) + 0.15, fz);
    this.course.add(fin);

    course.controls.forEach((c, i) => {
      const root = new Group();
      const y = field.heightAt(c.x, c.z);
      root.position.set(c.x, y, c.z);
      // orienteering flag: a square split on the diagonal, on a stake
      const flag = new LineSegments(
        segs([0, 0, 0, 0, 1.6, 0, 0, 1.6, 0, 0.8, 1.6, 0, 0.8, 1.6, 0, 0.8, 0.8, 0, 0.8, 0.8, 0, 0, 0.8, 0, 0, 1.6, 0, 0.8, 0.8, 0]),
        this.line(1),
      );
      const fillMat = new MeshBasicMaterial({ color: shared.uInk.value, side: DoubleSide, transparent: true, opacity: 0.85 });
      this.fillMats.push(fillMat);
      const half = new Mesh(segs([0, 1.6, 0, 0.8, 0.8, 0, 0, 0.8, 0]), fillMat);
      const ring = new LineLoop(segs(circle(PLAYER.punchRadius, 40).filter((_, k) => k % 6 < 3)), this.line(0.5));
      ring.position.y = 0.2;
      const sprite = new Sprite(new SpriteMaterial({ map: label(String(i + 1), ink), transparent: true, depthWrite: false }));
      sprite.scale.set(2.4, 2.4, 1);
      sprite.position.y = 3;
      root.add(flag, half, ring, sprite);
      this.course.add(root);
      this.flags.push({ root, ring, sprite });
    });

    for (const def of course.watchers) {
      const root = new Group();
      if (def.kind === 'tower') {
        const h = WATCH.towerHeight;
        const b = 1.4;
        const t = 0.7;
        const legs = [b, 0, b, t, h - 1, t, -b, 0, b, -t, h - 1, t, b, 0, -b, t, h - 1, -t, -b, 0, -b, -t, h - 1, -t];
        const deck = [-1.2, h - 1, -1.2, 1.2, h - 1, -1.2, 1.2, h - 1, -1.2, 1.2, h - 1, 1.2, 1.2, h - 1, 1.2, -1.2, h - 1, 1.2, -1.2, h - 1, 1.2, -1.2, h - 1, -1.2, 0, h - 1, 0, 0, h, 0];
        const brace = [b, 0, b, -t, h * 0.5, -t, -b, 0, b, t, h * 0.5, -t];
        root.add(new LineSegments(segs([...legs, ...deck, ...brace]), this.line(0.95)));
        root.position.set(def.x, field.heightAt(def.x, def.z), def.z);
      } else {
        root.add(new LineSegments(segs([0, 0, 0, 0, 1.4, 0, 0, 0.9, 0, 0.35, 0.5, 0, 0, 0.9, 0, -0.35, 0.5, 0]), this.line(0.95)));
        const hd = new LineLoop(segs(circle(0.2, 16, 1.65)), this.line(0.95));
        root.add(hd);
      }
      // searchlight: a faint fan and its two edges
      const beamMat = new MeshBasicMaterial({ color: shared.uInk.value, transparent: true, opacity: 0.05, side: DoubleSide, depthWrite: false });
      this.fillMats.push(beamMat);
      const beam = new Mesh(segs(new Array(9 * 16).fill(0)), beamMat);
      beam.frustumCulled = false;
      const beamEdges = new LineSegments(segs(new Array(12).fill(0)), this.line(0.35));
      beamEdges.frustumCulled = false;
      this.group.add(root, beam, beamEdges);
      this.watchers.push({ def, root, beam, beamEdges });
    }
  }

  update(player: Player, states: WatcherState[], field: HeightField, next: number, time: number, punched: boolean[]): void {
    // surveyor
    const crouch = player.posture === 'crouch';
    const top = crouch ? 0.8 : 1.45;
    this.body.geometry.dispose();
    const stride = Math.sin(player.walked * 2.2) * (crouch ? 0.1 : 0.28) * Math.min(player.speed / 3, 1);
    (this.body as LineSegments).geometry = segs([0, 0.9 * (top / 1.45), 0, 0, top, 0, 0, 0.9 * (top / 1.45), 0, stride, 0, 0, 0, 0.9 * (top / 1.45), 0, -stride, 0, 0, 0, top - 0.3, 0, 0.35, top - 0.6, -0.2, 0, top - 0.3, 0, -0.35, top - 0.6, 0.2]);
    const head = this.player.getObjectByName('head')!;
    head.position.y = top + 0.25;
    this.player.position.set(player.x, player.y, player.z);
    this.player.rotation.y = -player.facing;

    // flags
    this.flags.forEach((f, i) => {
      const isNext = i === next;
      f.ring.visible = !punched[i];
      f.ring.scale.setScalar(isNext ? 1 + 0.08 * Math.sin(time * 5) : 1);
      (f.sprite.material as SpriteMaterial).opacity = punched[i] ? 0.35 : isNext ? 1 : 0.7;
      f.root.rotation.y = time * 0.4;
    });

    // watchers and their beams
    this.watchers.forEach((w, i) => {
      const s = states[i];
      if (!s) return;
      if (w.def.kind === 'patrol') {
        w.root.position.set(s.eye.x, field.heightAt(s.eye.x, s.eye.z), s.eye.z);
        w.root.rotation.y = -s.heading;
      }
      const pos = w.beam.geometry.attributes.position.array as Float32Array;
      const n = 16;
      const pts: number[][] = [];
      for (let k = 0; k <= n; k++) {
        const a = s.heading - s.halfAngle + (2 * s.halfAngle * k) / n;
        const x = s.eye.x + Math.sin(a) * s.range;
        const z = s.eye.z - Math.cos(a) * s.range;
        pts.push([x, field.heightAt(Math.max(-238, Math.min(238, x)), Math.max(-238, Math.min(238, z))) + 1, z]);
      }
      for (let k = 0; k < n; k++) {
        pos.set([s.eye.x, s.eye.y, s.eye.z, ...pts[k], ...pts[k + 1]], k * 9);
      }
      w.beam.geometry.attributes.position.needsUpdate = true;
      const e = w.beamEdges.geometry.attributes.position.array as Float32Array;
      e.set([s.eye.x, s.eye.y, s.eye.z, ...pts[0], s.eye.x, s.eye.y, s.eye.z, ...pts[n]]);
      w.beamEdges.geometry.attributes.position.needsUpdate = true;
    });
  }

  dispose(m: Material): void {
    m.dispose();
  }
}
