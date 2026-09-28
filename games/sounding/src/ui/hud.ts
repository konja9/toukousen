import { Vector3, type Camera } from 'three';
import { FIELD, RUN, SONAR, SUB } from '../config';
import { floorAt } from '../field/grid';
import type { Label } from '../render/actors';
import { toChart, type ChartFrame } from '../render/chart';
import { shared } from '../render/uniforms';
import type { Contact } from '../sim/contacts';
import type { Dive } from '../sim/run';
import type { World } from '../sim/world';

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const SANS = "'Inter', 'Noto Sans JP', system-ui, sans-serif";
const JP = "'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif";

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(0).padStart(2, '0')}`;
};

export const diveNo = (seed: number) => `#${String(seed).padStart(4, '0')}`;
const LEVELS = ['停止', '微速', '半速', '全速'];
const LEVELS_EN = ['STOP', 'SLOW', 'HALF', 'FULL'];

/** Where a contact was last pinpointed (its own ping gives it away). */
export interface Known {
  x: number;
  z: number;
  t: number;
  kind: Contact['kind'];
}

export interface DiveHud {
  world: World;
  dive: Dive;
  known: Map<number, Known>;
  /** 0..1: how far the full chart is open. */
  chartT: number;
}

/** Canvas-2D overlay: instruments, 3D labels and the chart overprint. */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private inkRGB = '233,236,234';
  private bgRGB = '6,7,8';
  private readonly v = new Vector3();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hud';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  syncColors(): void {
    const c = (v: { r: number; g: number; b: number }) => `${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)}`;
    this.inkRGB = c(shared.uInk.value);
    this.bgRGB = c(shared.uBg.value);
  }

  private ink(a: number): string {
    return `rgba(${this.inkRGB},${a})`;
  }

  private bg(a: number): string {
    return `rgba(${this.bgRGB},${a})`;
  }

  begin(): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.textBaseline = 'middle';
    g.lineCap = 'butt';
    g.setLineDash([]);
  }

  private text(s: string, x: number, y: number, size: number, o: { font?: string; weight?: number; align?: CanvasTextAlign; a?: number; spacing?: number; bg?: boolean } = {}): number {
    const g = this.g;
    g.font = `${o.weight ?? 400} ${size}px ${o.font ?? MONO}`;
    g.textAlign = o.align ?? 'left';
    const ls = 'letterSpacing' in g;
    if (ls) (g as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
    const w = g.measureText(s).width;
    if (o.bg) {
      const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      g.fillStyle = this.bg(0.75);
      g.fillRect(x0 - 4, y - size * 0.7, w + 8, size * 1.4);
    }
    g.fillStyle = this.ink(o.a ?? 1);
    g.fillText(s, x, y);
    if (ls) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
    return w;
  }

  private line(x1: number, y1: number, x2: number, y2: number, a: number, w = 1, dash?: number[]): void {
    const g = this.g;
    g.strokeStyle = this.ink(a);
    g.lineWidth = w;
    if (dash) g.setLineDash(dash);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    if (dash) g.setLineDash([]);
  }

  private bar(x: number, y: number, w: number, v: number, a: number, warn = false, time = 0): void {
    const g = this.g;
    this.line(x, y, x + w, y, 0.28 * a);
    const blink = warn ? 0.55 + 0.45 * Math.sin(time * 10) : 1;
    g.fillStyle = this.ink(0.95 * a * blink);
    g.fillRect(x, y - 2.5, w * Math.max(0, Math.min(1, v)), 5);
    for (let i = 0; i <= 4; i++) this.line(x + (w * i) / 4, y + 4, x + (w * i) / 4, y + 8, 0.3 * a);
  }

  corners(alpha: number): void {
    if (alpha <= 0) return;
    const m = 18;
    const L = 16;
    const { w, h } = this;
    for (const [x, y, dx, dy] of [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ]) {
      this.line(x, y, x + dx * L, y, 0.5 * alpha);
      this.line(x, y, x, y + dy * L, 0.5 * alpha);
    }
  }

  /** Minimap in the corner, growing into the full chart as `t` goes to 1. */
  chartFrame(world: World, t: number): ChartFrame {
    const small = Math.min(230, this.w * 0.22);
    const sx = this.w - small - 34;
    const sy = this.h - small - 34;
    const big = Math.min(this.h * 0.84, this.w * 0.62);
    const bx = (this.w - big) / 2;
    const by = (this.h - big) / 2;
    const k = t * t * (3 - 2 * t);
    const size = small + (big - small) * k;
    const mppSmall = 1.45;
    const mppBig = (2 * FIELD.half + 30) / big;
    return {
      cx: world.sub.x * (1 - k),
      cz: world.sub.z * (1 - k),
      mpp: mppSmall + (mppBig - mppSmall) * k,
      x: sx + (bx - sx) * k,
      y: sy + (by - sy) * k,
      w: size,
      h: size,
      opacity: 1,
    };
  }

  dive(d: DiveHud, alpha: number, time: number, camera: Camera, labels: Label[]): void {
    if (alpha <= 0) return;
    const { w, h } = this;
    const a = alpha;
    const wd = d.world;
    const sub = wd.sub;
    const g = this.g;
    this.corners(a);
    const threat = wd.threat;

    // edge pulse while hunted
    if (threat === 'hunt') {
      const p = 0.5 + 0.5 * Math.sin(time * 6);
      g.strokeStyle = this.ink(0.1 + 0.25 * p);
      g.lineWidth = 3 + 5 * p;
      g.strokeRect(6, 6, w - 12, h - 12);
    }

    // ---- labels in the scene
    for (const l of labels) {
      this.v.set(l.x, l.y, l.z).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const la = l.alpha * a;
      this.line(x, y, x + 10, y - 10, 0.7 * la);
      this.text(l.text, x + 13, y - 16, 12, { font: JP, a: la, spacing: 1 });
      if (l.sub) this.text(l.sub, x + 13, y - 1, 9, { a: 0.6 * la, spacing: 2 });
    }

    // ---- top-left: dive, sector, depth
    this.text(`DIVE ${diveNo(d.dive.seed)} · SECTOR ${String(d.dive.index).padStart(2, '0')}`, 40, 42, 10.5, { a: 0.55 * a, spacing: 2.5 });
    const depth = Math.max(0, -sub.y);
    const dw = this.text(depth.toFixed(0), 40, 84, 46, { font: SANS, weight: 200, a });
    this.text('m', 46 + dw, 94, 13, { a: 0.7 * a });
    const below = sub.y < wd.layerY;
    this.text(below ? '躍層の下 · BELOW LAYER' : '躍層の上 · ABOVE LAYER', 40, 122, 11, { font: JP, a: (below ? 0.75 : 0.95) * a, spacing: 1 });
    const found = wd.surveys.filter((s) => s.found).length;
    this.text(`測点 ${found} / ${wd.surveys.length}`, 40, 146, 11, { font: JP, a: 0.6 * a, spacing: 1 });
    this.text(wd.exitLitAt > -1e8 ? '降下口 · 確認済み' : '降下口 · 未確認（海図の破線円のあたり）', 40, 166, 11, { font: JP, a: 0.6 * a, spacing: 1 });

    // ---- top-center: compass with the contacts we can hear
    const cw = Math.min(460, w * 0.36);
    this.compass(w / 2, 46, cw, sub.heading, a);
    for (const k of wd.audible()) {
      const brg = Math.atan2(k.x - sub.x, -(k.z - sub.z));
      let rel = ((brg - sub.heading) * 180) / Math.PI;
      rel = ((rel + 540) % 360) - 180;
      const x = w / 2 + rel * 2.4;
      if (Math.abs(x - w / 2) > cw / 2) continue;
      const hot = k.mode === 'hunt';
      const blink = hot ? 0.5 + 0.5 * Math.sin(time * 12) : 1;
      g.fillStyle = this.ink(a * blink);
      g.beginPath();
      g.moveTo(x, 78);
      g.lineTo(x - 5, 70);
      g.lineTo(x + 5, 70);
      g.closePath();
      if (k.mode === 'patrol' || k.mode === 'return') {
        g.strokeStyle = this.ink(a);
        g.lineWidth = 1;
        g.stroke();
      } else g.fill();
      const name = k.kind === 'ship' ? '艦' : k.kind === 'hunter' ? '潜' : '浮';
      let label = name;
      if (wd.mods.passive) label += ` ${Math.round(Math.hypot(k.x - sub.x, k.y - sub.y, k.z - sub.z))}m`;
      this.text(label, x, 90, 11, { font: JP, a: 0.85 * a, align: 'center' });
    }

    // ---- top-right: hull, battery, sonar
    const rx = w - 40;
    const bw = 150;
    this.text('HULL 船体', rx - bw, 40, 10, { font: JP, a: 0.6 * a, spacing: 2 });
    this.text(`${Math.ceil(sub.hull)}`, rx, 40, 11, { a: 0.9 * a, align: 'right' });
    this.bar(rx - bw, 54, bw, sub.hull / wd.mods.hullMax, a, sub.hull < 30, time);
    this.text('BATTERY 電池', rx - bw, 76, 10, { font: JP, a: 0.6 * a, spacing: 2 });
    this.text(`${Math.floor(sub.battery)}`, rx, 76, 11, { a: 0.9 * a, align: 'right' });
    this.bar(rx - bw, 90, bw, sub.battery / wd.mods.batteryMax, a, sub.battery < 15, time);
    const cd = wd.pingCooldown;
    const canPing = cd <= 0 && sub.battery >= SONAR.cost;
    this.text(canPing ? 'SONAR READY' : sub.battery < SONAR.cost ? 'SONAR · NO POWER' : 'SONAR ···', rx, 114, 10.5, { a: (canPing ? 0.9 : 0.45) * a, align: 'right', spacing: 2 });
    let ry = 134;
    if (wd.mods.cone) {
      this.text('F 指向性ソナー', rx, ry, 10.5, { font: JP, a: 0.6 * a, align: 'right' });
      ry += 18;
    }
    if (wd.decoysLeft > 0) this.text(`X 囮 ×${wd.decoysLeft}`, rx, ry, 10.5, { font: JP, a: 0.6 * a, align: 'right' });

    // ---- right edge: depth ladder
    this.ladder(d, a);

    // ---- bottom-left: throttle and noise
    const lvl = Math.min(sub.level, sub.maxLevel);
    const bx = 40;
    const byy = h - 92;
    this.text('SPEED 速力', bx, byy - 22, 10, { font: JP, a: 0.6 * a, spacing: 2 });
    for (let i = 0; i < 4; i++) {
      const x = bx + i * 52;
      const on = i === lvl;
      g.strokeStyle = this.ink(0.5 * a);
      g.lineWidth = 1;
      if (on) {
        g.fillStyle = this.ink(0.95 * a);
        g.fillRect(x, byy - 10, 46, 22);
      } else g.strokeRect(x + 0.5, byy - 9.5, 45, 21);
      g.font = `400 11px ${JP}`;
      g.textAlign = 'center';
      g.fillStyle = on ? this.bg(1) : this.ink(0.7 * a);
      g.fillText(LEVELS[i], x + 23, byy + 1);
    }
    this.text(`${Math.abs(sub.speed).toFixed(1)} m/s · ${LEVELS_EN[lvl]}`, bx, byy + 30, 10.5, { a: 0.6 * a, spacing: 1.5 });
    this.text(`機関音 ${Math.round(sub.noise(wd.mods))} m 先まで`, bx, byy + 50, 10.5, { font: JP, a: 0.6 * a });

    // ---- bottom-center: threat and keys
    const word = threat === 'hunt' ? '探知された · DETECTED' : threat === 'search' ? '捜索中 · SEARCHING' : '静穏 · QUIET';
    const blink = threat === 'hunt' ? 0.5 + 0.5 * Math.sin(time * 10) : threat === 'search' ? 0.75 + 0.25 * Math.sin(time * 4) : 0.55;
    this.text(word, w / 2, h - 70, 12, { font: JP, a: blink * a, align: 'center', spacing: 3 });
    const keys = 'W/S 速力 · A/D 転舵 · Q/E 浮上/潜航 · SPACE ソナー · M 海図 · ドラッグ 視点';
    this.text(keys, w / 2, h - 40, 10.5, { font: JP, a: 0.4 * a * (1 - d.chartT), align: 'center' });
  }

  private compass(cx: number, y: number, W: number, heading: number, a: number): void {
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    const ppd = 2.4;
    const half = W / 2;
    this.line(cx - half, y, cx + half, y, 0.3 * a);
    for (let dd = Math.floor((deg - half / ppd) / 5) * 5; dd <= deg + half / ppd; dd += 5) {
      const x = cx + (dd - deg) * ppd;
      if (x < cx - half || x > cx + half) continue;
      const fade = 1 - Math.pow(Math.abs(x - cx) / half, 3);
      const n = ((dd % 360) + 360) % 360;
      const major = n % 45 === 0;
      this.line(x, y, x, y + (major ? 10 : 4), (major ? 0.85 : 0.35) * a * fade);
      if (major) {
        const label = ({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' } as Record<number, string>)[n];
        this.text(label, x, y - 12, n % 90 === 0 ? 12 : 9.5, { a: (n === 0 ? 1 : 0.7) * a * fade, align: 'center' });
      }
    }
    const g = this.g;
    g.fillStyle = this.ink(a);
    g.beginPath();
    g.moveTo(cx, y + 2);
    g.lineTo(cx - 4, y + 9);
    g.lineTo(cx + 4, y + 9);
    g.closePath();
    g.fill();
  }

  private ladder(d: DiveHud, a: number): void {
    const wd = d.world;
    const sub = wd.sub;
    const x = this.w - 58;
    const y0 = this.h * 0.26;
    const y1 = this.h * 0.64;
    const maxD = Math.max(260, Math.ceil((-wd.sector.exitY + 20) / 50) * 50);
    const Y = (depth: number) => y0 + (depth / maxD) * (y1 - y0);
    this.line(x, y0, x, y1, 0.35 * a);
    const sy0 = Y(-sub.y);
    for (let dd = 0; dd <= maxD; dd += 50) {
      this.line(x - 4, Y(dd), x, Y(dd), 0.45 * a);
      // keep the tick numbers clear of the sub's own readout
      if (Math.abs(Y(dd) - sy0) > 11) this.text(`${dd}`, x - 8, Y(dd), 9, { a: 0.45 * a, align: 'right' });
    }
    this.text('DEPTH', x, y0 - 18, 9.5, { a: 0.5 * a, align: 'center', spacing: 2 });
    // layer
    const ly = Y(-wd.layerY);
    this.line(x - 16, ly, x + 16, ly, 0.8 * a, 1, [3, 3]);
    this.text('躍層', x + 20, ly - (Math.abs(ly - sy0) < 12 ? 12 : 0), 10, { font: JP, a: 0.75 * a });
    // floor under the keel
    const fy = Y(-floorAt(wd.floor, sub.x, sub.z));
    const g = this.g;
    g.fillStyle = this.ink(0.35 * a);
    g.fillRect(x - 10, fy, 20, 3);
    this.text('海底', x + 20, fy + 2, 10, { font: JP, a: 0.55 * a });
    // the sub
    const sy = Y(-sub.y);
    g.fillStyle = this.ink(a);
    g.beginPath();
    g.moveTo(x + 2, sy);
    g.lineTo(x + 11, sy - 5);
    g.lineTo(x + 11, sy + 5);
    g.closePath();
    g.fill();
    const clear = sub.y - floorAt(wd.floor, sub.x, sub.z) - SUB.radius;
    this.text(`↓${Math.max(0, clear).toFixed(0)}m`, x - 12, sy, 10, { a: (clear < 8 ? 1 : 0.6) * a, align: 'right' });
  }

  /** Overprint on the chart: sheet edge, exit circle, marks, the track, our boat, what we know of the others. */
  chartOverlay(f: ChartFrame, d: DiveHud, alpha: number, time: number, log = false): void {
    const g = this.g;
    const a = alpha * f.opacity;
    if (a <= 0) return;
    const wd = d.world;
    g.save();
    g.beginPath();
    g.rect(f.x, f.y, f.w, f.h);
    g.clip();
    const P = (x: number, z: number) => toChart(f, x, z);
    // sector edge
    const [ax, ay] = P(-FIELD.half, -FIELD.half);
    const [bx, by] = P(FIELD.half, FIELD.half);
    g.strokeStyle = this.ink(0.6 * a);
    g.lineWidth = 1;
    g.strokeRect(ax, ay, bx - ax, by - ay);
    // exit: the rough area until found, then the trench itself
    const hint = wd.sector.exitHint;
    const [hx, hy] = P(hint.x, hint.z);
    if (wd.exitLitAt < -1e8 && !log) {
      g.setLineDash([4, 5]);
      g.strokeStyle = this.ink(0.75 * a);
      g.beginPath();
      g.arc(hx, hy, hint.r / f.mpp, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      this.text('降下口？', hx, hy, 11, { font: JP, a: 0.8 * a, align: 'center', bg: true });
    } else {
      const [ex, ey] = P(wd.sector.exit[0], wd.sector.exit[1]);
      g.strokeStyle = this.ink(a);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(ex, ey, Math.max(5, RUN.exitRadius / f.mpp), 0, Math.PI * 2);
      g.stroke();
      this.line(ex - 4, ey - 2, ex, ey + 4, a, 1.6);
      this.line(ex + 4, ey - 2, ex, ey + 4, a, 1.6);
      this.text('降下口', ex, ey - Math.max(5, RUN.exitRadius / f.mpp) - 10, 11, { font: JP, a, align: 'center', bg: true });
    }
    // entry
    const [nx, ny] = P(wd.sector.entry[0], wd.sector.entry[1]);
    g.strokeStyle = this.ink(0.7 * a);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(nx, ny - 6);
    g.lineTo(nx - 5, ny + 4);
    g.lineTo(nx + 5, ny + 4);
    g.closePath();
    g.stroke();
    // survey marks and spotted mines
    for (const s of wd.surveys) {
      if (!s.found && !log) continue;
      const [sx, sy] = P(s.x, s.z);
      g.strokeStyle = this.ink(a);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(sx, sy - 6);
      g.lineTo(sx + 6, sy);
      g.lineTo(sx, sy + 6);
      g.lineTo(sx - 6, sy);
      g.closePath();
      if (s.found) {
        g.fillStyle = this.ink(a);
        g.fill();
      } else g.stroke();
    }
    for (const m of wd.mines) {
      if (m.litAt < -1e8) continue;
      const [mx, my] = P(m.x, m.z);
      this.line(mx - 4, my - 4, mx + 4, my + 4, a * (m.alive ? 1 : 0.35), 1.4);
      this.line(mx - 4, my + 4, mx + 4, my - 4, a * (m.alive ? 1 : 0.35), 1.4);
    }
    // track: heavier where the boat was above the layer
    const tr = wd.track;
    for (let i = 1; i < tr.length; i++) {
      const [x0, y0] = P(tr[i - 1][0], tr[i - 1][1]);
      const [x1, y1] = P(tr[i][0], tr[i][1]);
      this.line(x0, y0, x1, y1, (tr[i][2] ? 0.95 : 0.6) * a, tr[i][2] ? 2.6 : 1.1);
    }
    // our own ping, growing on the chart too
    for (const { ping } of wd.pings) {
      const r = (wd.t - ping.t0) * ping.speed;
      if (r <= 0 || r > ping.range) continue;
      const [px, py] = P(ping.x, ping.z);
      g.strokeStyle = this.ink((ping.kind === 'own' ? 0.6 : 0.35) * a * (1 - r / ping.range));
      g.lineWidth = 1;
      if (ping.kind !== 'own') g.setLineDash([3, 4]);
      g.beginPath();
      g.arc(px, py, r / f.mpp, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    // what we know of the others: where they last pinged, and bearings to what we hear
    for (const [, k] of d.known) {
      const age = wd.t - k.t;
      if (age > 40) continue;
      const [kx, ky] = P(k.x, k.z);
      const ka = a * Math.max(0.25, 1 - age / 40);
      g.strokeStyle = this.ink(ka);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(kx, ky - 7);
      g.lineTo(kx - 6, ky + 5);
      g.lineTo(kx + 6, ky + 5);
      g.closePath();
      g.stroke();
      this.text(`${k.kind === 'ship' ? '艦' : k.kind === 'hunter' ? '潜' : '浮'} ${age.toFixed(0)}s`, kx + 9, ky, 10, { font: JP, a: ka, bg: true });
    }
    const [sx, sy] = P(wd.sub.x, wd.sub.z);
    if (!log) {
      for (const k of wd.audible()) {
        const brg = Math.atan2(k.x - wd.sub.x, -(k.z - wd.sub.z));
        const L = 120 / f.mpp;
        this.line(sx, sy, sx + Math.sin(brg) * L, sy - Math.cos(brg) * L, 0.45 * a, 1, [2, 4]);
      }
    }
    // our boat
    const hd = wd.sub.heading;
    const tri = (r: number, ang: number): [number, number] => [sx + Math.sin(hd + ang) * r, sy - Math.cos(hd + ang) * r];
    const [p0x, p0y] = tri(9, 0);
    const [p1x, p1y] = tri(6, 2.5);
    const [p2x, p2y] = tri(6, -2.5);
    g.fillStyle = this.ink(a);
    g.beginPath();
    g.moveTo(p0x, p0y);
    g.lineTo(p1x, p1y);
    g.lineTo(p2x, p2y);
    g.closePath();
    g.fill();
    if (!log) {
      const pulse = (time * 0.8) % 1;
      g.strokeStyle = this.ink(0.5 * a * (1 - pulse));
      g.beginPath();
      g.arc(sx, sy, 6 + pulse * 14, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    // frame and captions
    g.strokeStyle = this.ink(0.55 * a);
    g.lineWidth = 1;
    g.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
    if (!log) {
      this.text('CHART 海図', f.x + 8, f.y + 13, 10, { font: JP, a: 0.7 * a, spacing: 2, bg: true });
      this.text(`等深線 10 m · 破線 = 躍層 ${(-wd.layerY).toFixed(0)} m`, f.x + 8, f.y + f.h - 12, 10, { font: JP, a: 0.6 * a, bg: true });
      this.text('N ↑', f.x + f.w - 10, f.y + 13, 10, { a: 0.7 * a, align: 'right', bg: true });
    }
  }
}
