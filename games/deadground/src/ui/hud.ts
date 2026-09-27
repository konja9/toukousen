import { FEATURE_TEXT } from '../field/features';
import { toMap, type MapFrame } from '../render/mapview';
import { shared } from '../render/uniforms';
import type { Course } from '../sim/course';
import type { WatcherDef } from '../sim/watchers';
import { WATCH } from '../config';

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const SANS = "'Inter', 'Noto Sans JP', system-ui, sans-serif";
const JP = "'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif";

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
};

export interface RunInfo {
  course: Course;
  next: number;
  time: number;
  penalties: number;
  alert: number;
  seen: boolean;
  heard: boolean;
  heading: number;
  posture: 'stand' | 'crouch';
  sprinting: boolean;
  orienteering: boolean;
  locked: boolean;
  /** 0..1 how far the map panel is open (it covers the right-hand column). */
  mapT: number;
}

/** Canvas-2D overlay: run instruments and the course overprint on the map. */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private inkRGB = '236,235,230';
  private bgRGB = '11,11,11';

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

  private line(x1: number, y1: number, x2: number, y2: number, a: number, w = 1): void {
    const g = this.g;
    g.strokeStyle = this.ink(a);
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
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

  run(r: RunInfo, alpha: number, time: number): void {
    if (alpha <= 0) return;
    const { w, h } = this;
    const a = alpha;
    this.corners(a);
    const c = r.course;

    // ---- top-left: next control and its description
    this.text(`SHEET ${String(c.id).padStart(2, '0')} · ${c.name}`, 40, 42, 10.5, { a: 0.55 * a, spacing: 2.5 });
    if (r.next < c.controls.length) {
      const ctl = c.controls[r.next];
      const t = FEATURE_TEXT[ctl.kind];
      this.text(`${r.next + 1}`, 40, 84, 44, { font: SANS, weight: 200, a });
      this.text(t.ja, 92, 76, 16, { font: JP, weight: 300, a });
      this.text(t.en, 92, 98, 10.5, { a: 0.65 * a, spacing: 3 });
      this.text(`CONTROL ${r.next + 1} / ${c.controls.length}`, 40, 124, 10.5, { a: 0.55 * a, spacing: 2 });
    } else {
      this.text('◎', 40, 84, 36, { font: SANS, weight: 200, a });
      this.text('フィニッシュへ', 92, 76, 16, { font: JP, weight: 300, a });
      this.text('TO FINISH', 92, 98, 10.5, { a: 0.65 * a, spacing: 3 });
    }

    // ---- top-right: time (hidden behind the open map)
    const ra = a * (1 - r.mapT);
    this.text('TIME', w - 40, 42, 10.5, { a: 0.55 * ra, align: 'right', spacing: 3 });
    this.text(fmtTime(r.time), w - 40, 74, 30, { font: SANS, weight: 200, a: ra, align: 'right' });
    if (r.penalties > 0) this.text(`+${r.penalties * WATCH.caughtPenalty}s PENALTY`, w - 40, 102, 10.5, { a: 0.7 * ra, align: 'right', spacing: 2 });
    this.text(r.orienteering ? '読図モード · 現在地なし' : '通常モード', w - 40, 124, 11, { font: JP, a: 0.5 * ra, align: 'right', spacing: 1 });

    // ---- top-center: compass tape
    this.compass(w / 2, 46, Math.min(420, w * 0.36), r.heading, a);

    // ---- bottom-center: alert gauge
    const bw = Math.min(320, w * 0.3);
    const bx = w / 2 - bw / 2;
    const by = h - 64;
    const g = this.g;
    const hot = r.alert > 0.6;
    const blink = hot ? 0.55 + 0.45 * Math.sin(time * 16) : 1;
    this.text(r.seen ? 'SEEN' : r.heard ? 'HEARD' : 'HIDDEN', w / 2, by - 18, 11, { a: (r.seen || r.heard ? blink : 0.55) * a, align: 'center', spacing: 5 });
    this.line(bx, by, bx + bw, by, 0.3 * a);
    g.fillStyle = this.ink(0.95 * a * blink);
    g.fillRect(bx, by - 3, bw * r.alert, 6);
    for (let i = 0; i <= 10; i++) this.line(bx + (bw * i) / 10, by + 5, bx + (bw * i) / 10, by + (i % 5 ? 8 : 11), 0.35 * a);

    // ---- bottom-left: posture
    const pz = r.posture === 'crouch' ? '伏せ CROUCH' : r.sprinting ? '疾走 SPRINT' : '走行 RUN';
    this.text('POSTURE', 40, h - 78, 10, { a: 0.55 * a, spacing: 3 });
    this.text(pz, 40, h - 56, 13, { font: JP, a: 0.9 * a, spacing: 1 });

    // ---- bottom-right: keys
    const keys = ['WASD 移動 · マウス 視点', 'SHIFT 疾走 · C 伏せ', 'M 地図 · ESC 一時停止'];
    keys.forEach((k, i) => this.text(k, w - 40, h - 86 + i * 20, 11, { font: JP, a: 0.45 * ra, align: 'right', spacing: 0.5 }));
    if (!r.locked) this.text('クリックで視点操作（またはドラッグ）', w / 2, h - 24, 11, { font: JP, a: 0.45 * a, align: 'center' });
  }

  private compass(cx: number, y: number, W: number, heading: number, a: number): void {
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    const ppd = 2.4;
    const half = W / 2;
    this.line(cx - half, y, cx + half, y, 0.3 * a);
    for (let d = Math.floor((deg - half / ppd) / 5) * 5; d <= deg + half / ppd; d += 5) {
      const x = cx + (d - deg) * ppd;
      if (x < cx - half || x > cx + half) continue;
      const fade = 1 - Math.pow(Math.abs(x - cx) / half, 3);
      const n = ((d % 360) + 360) % 360;
      const major = n % 45 === 0;
      this.line(x, y, x, y + (major ? 10 : 4), (major ? 0.85 : 0.35) * a * fade);
      if (n % 45 === 0) {
        const label = ({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' } as Record<number, string>)[n];
        this.text(label, x, y + 22, n % 90 === 0 ? 12 : 9.5, { a: (n === 0 ? 1 : 0.7) * a * fade, align: 'center' });
      }
    }
    const g = this.g;
    g.fillStyle = this.ink(a);
    g.beginPath();
    g.moveTo(cx, y - 2);
    g.lineTo(cx - 4, y - 9);
    g.lineTo(cx + 4, y - 9);
    g.closePath();
    g.fill();
  }

  /** Course overprint and symbols on the paper map. */
  mapOverlay(f: MapFrame, c: Course, opts: { next: number; punched: boolean[]; player?: { x: number; z: number; facing: number }; trail?: Array<[number, number, number]>; alpha: number }): void {
    const g = this.g;
    const a = opts.alpha * f.opacity;
    if (a <= 0) return;
    g.save();
    g.beginPath();
    g.rect(f.x, f.y, f.w, f.h);
    g.clip();

    // magnetic-north lines every 60 m, as on an orienteering map
    for (let x = -240; x <= 240; x += 60) {
      const [sx] = toMap(f, x, 0);
      const [, y0] = toMap(f, 0, -240);
      const [, y1] = toMap(f, 0, 240);
      this.line(sx, y0, sx, y1, 0.12 * a);
    }
    // sheet border
    const [bx0, by0] = toMap(f, -240, -240);
    const [bx1, by1] = toMap(f, 240, 240);
    g.strokeStyle = this.ink(0.7 * a);
    g.lineWidth = 1.2;
    g.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

    // watchers
    for (const w of c.watchers) this.watcherSymbol(f, w, a);

    // trail (result screen): thicker where seen
    if (opts.trail && opts.trail.length > 1) {
      g.lineJoin = 'round';
      for (let i = 1; i < opts.trail.length; i++) {
        const [x0, z0] = opts.trail[i - 1];
        const [x1, z1, seen] = opts.trail[i];
        const [ax, ay] = toMap(f, x0, z0);
        const [cx, cy] = toMap(f, x1, z1);
        this.line(ax, ay, cx, cy, (seen ? 1 : 0.8) * a, seen ? 3.2 : 1.4);
      }
    }

    // course: start triangle, numbered circles joined by lines, finish double circle
    const pts: Array<[number, number]> = [toMap(f, c.start[0], c.start[1]), ...c.controls.map((k) => toMap(f, k.x, k.z)), toMap(f, c.finish[0], c.finish[1])];
    const R = 11;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d < 2 * R + 4) continue;
      const ux = (x1 - x0) / d;
      const uy = (y1 - y0) / d;
      this.line(x0 + ux * (R + 2), y0 + uy * (R + 2), x1 - ux * (R + 2), y1 - uy * (R + 2), 0.95 * a, 2);
    }
    const [sx, sy] = pts[0];
    g.strokeStyle = this.ink(a);
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(sx, sy - 13);
    g.lineTo(sx + 11, sy + 7);
    g.lineTo(sx - 11, sy + 7);
    g.closePath();
    g.stroke();
    c.controls.forEach((_, i) => {
      const [x, y] = pts[i + 1];
      const done = opts.punched[i];
      g.strokeStyle = this.ink((done ? 0.4 : 1) * a);
      g.lineWidth = i === opts.next ? 3 : 2.2;
      g.beginPath();
      g.arc(x, y, R, 0, Math.PI * 2);
      g.stroke();
      this.text(String(i + 1), x + R + 4, y - R, 14, { font: SANS, weight: 400, a: (done ? 0.45 : 1) * a, bg: true });
    });
    const [fx, fy] = pts[pts.length - 1];
    for (const r of [8, 13]) {
      g.beginPath();
      g.arc(fx, fy, r, 0, Math.PI * 2);
      g.strokeStyle = this.ink(a);
      g.lineWidth = 2.2;
      g.stroke();
    }

    if (opts.player) {
      const [px, py] = toMap(f, opts.player.x, opts.player.z);
      const hd = opts.player.facing;
      const fx2 = Math.sin(hd);
      const fy2 = -Math.cos(hd);
      g.fillStyle = this.ink(a);
      g.beginPath();
      g.moveTo(px + fx2 * 10, py + fy2 * 10);
      g.lineTo(px - fy2 * 5 - fx2 * 5, py + fx2 * 5 - fy2 * 5);
      g.lineTo(px + fy2 * 5 - fx2 * 5, py - fx2 * 5 - fy2 * 5);
      g.closePath();
      g.fill();
      g.strokeStyle = this.bg(a);
      g.lineWidth = 1;
      g.stroke();
    }
    g.restore();
  }

  private watcherSymbol(f: MapFrame, w: WatcherDef, a: number): void {
    const g = this.g;
    if (w.kind === 'tower') {
      const [x, y] = toMap(f, w.x, w.z);
      const R = WATCH.towerRange / f.mpp;
      g.setLineDash([4, 4]);
      g.strokeStyle = this.ink(0.75 * a);
      g.lineWidth = 1;
      g.beginPath();
      if (w.mode === 'sweep') {
        // the arc the light sweeps, drawn as a wedge
        const a0 = w.from - WATCH.towerHalfAngle - Math.PI / 2;
        const a1 = w.to + WATCH.towerHalfAngle - Math.PI / 2;
        g.moveTo(x, y);
        g.arc(x, y, R, a0, a1);
        g.closePath();
      } else g.arc(x, y, R, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // tower symbol: a filled square with a ring
      g.fillStyle = this.bg(0.9 * a);
      g.beginPath();
      g.arc(x, y, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = this.ink(a);
      g.fillRect(x - 5, y - 5, 10, 10);
      g.beginPath();
      g.arc(x, y, 12, 0, Math.PI * 2);
      g.strokeStyle = this.ink(a);
      g.lineWidth = 1.2;
      g.stroke();
      if (w.mode === 'spin') this.text('↻', x + 12, y - 11, 12, { font: SANS, a: 0.9 * a });
    } else {
      g.setLineDash([5, 4]);
      g.strokeStyle = this.ink(0.7 * a);
      g.lineWidth = 1.2;
      g.beginPath();
      w.path.forEach(([px, pz], i) => {
        const [x, y] = toMap(f, px, pz);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      const [x, y] = toMap(f, w.path[0][0], w.path[0][1]);
      this.text('PATROL', x + 8, y, 9.5, { a: 0.7 * a, spacing: 1.5, bg: true });
    }
  }

  /** Paper-map frame decorations (title strip and scale). */
  mapFrame(f: MapFrame, c: Course, alpha: number, orienteering: boolean): void {
    const a = alpha * f.opacity;
    if (a <= 0) return;
    const g = this.g;
    g.strokeStyle = this.ink(0.6 * a);
    g.lineWidth = 1;
    g.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
    this.text(`SHEET ${String(c.id).padStart(2, '0')}  ${c.name}  ${c.nameJa}`, f.x + 14, f.y + 18, 11, { a, spacing: 2, bg: true });
    this.text(orienteering ? '読図モード：現在地は表示されない' : '通常モード：▲ が現在地', f.x + f.w - 14, f.y + 18, 11, { font: JP, a: 0.8 * a, align: 'right', bg: true });
    // scale bar 100 m and contour interval
    const px = 100 / f.mpp;
    const x0 = f.x + 14;
    const y0 = f.y + f.h - 18;
    this.line(x0, y0, x0 + px, y0, a);
    this.line(x0, y0 - 5, x0, y0, a);
    this.line(x0 + px, y0 - 5, x0 + px, y0, a);
    this.text('100 m · 等高線 5 m', x0 + px + 10, y0 - 1, 10.5, { font: JP, a: 0.8 * a, bg: true });
    this.text('N ↑', f.x + f.w - 14, f.y + f.h - 18, 12, { a, align: 'right', bg: true });
  }
}
