import { clamp01, easeOutCubic } from '../core/tween';
import { mapToScreen, type MapFrame } from '../world/mapView';
import { shared } from '../world/uniforms';
import { fmt } from './screens';

export interface FlightInfo {
  alt: number;
  ground: number;
  agl: number;
  vy: number;
  speed: number;
  yaw: number;
  score: number;
  distance: number;
  time: number;
  best: number;
  sheet: number;
  mult: number;
  chain: number;
  lift: number;
  /** Vertical speed of the air: thermals plus ridge lift (m/s). */
  air: number;
  stall: boolean;
  terrain: boolean;
  /** Flight-path marker in CSS px, or null when off-screen. */
  fpm: [number, number] | null;
  radar: MapFrame;
  thermals: Array<{ x: number; z: number; radius: number }>;
  gates: Array<{ x: number; z: number; nx: number; nz: number; next: boolean }>;
  x: number;
  z: number;
  clock: ClockInfo;
  /** Wind at the glider (m/s). */
  wind: { x: number; z: number };
  /** z of the next checkpoint, for the radar. */
  cpZ: number | null;
  missions: MissionLine[];
  /** 0..1 strength of the speed lines. */
  rush: number;
}

export interface ClockInfo {
  remaining: number;
  /** Sector being flown (1-based). */
  sector: number;
  /** Distance to the next checkpoint (m). */
  toNext: number;
  /** Seconds added at the last checkpoint, and how long ago. */
  added: number;
  addedAge: number;
}

export interface MissionLine {
  label: string;
  progress: number;
  done: boolean;
}

export interface PathPoint {
  x: number;
  z: number;
}

interface Pop {
  text: string;
  sub: string;
  age: number;
}

interface Banner {
  title: string;
  lines: string[];
  age: number;
}

const BANNER_TIME = 3.4;

/** m:ss.s */
export function clockText(s: number): string {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const SANS = "'Inter', 'Noto Sans JP', system-ui, sans-serif";

/** Canvas-2D overlay: flight instruments, radar frame, map annotations. */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pops: Pop[] = [];
  private bannerNow: Banner | null = null;
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

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  syncColors(): void {
    const c = (v: { r: number; g: number; b: number }) =>
      `${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)}`;
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
    g.lineCap = 'butt';
    g.textBaseline = 'middle';
  }

  private text(s: string, x: number, y: number, size: number, opts: { font?: string; weight?: number; align?: CanvasTextAlign; a?: number; spacing?: number } = {}): void {
    const g = this.g;
    g.font = `${opts.weight ?? 400} ${size}px ${opts.font ?? MONO}`;
    g.textAlign = opts.align ?? 'left';
    g.fillStyle = this.ink(opts.a ?? 1);
    if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${opts.spacing ?? 0}px`;
    g.fillText(s, x, y);
    if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
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

  /** Thin L-shaped marks in the four corners. */
  corners(alpha: number): void {
    if (alpha <= 0) return;
    const m = 18;
    const L = 16;
    const { w, h } = this;
    const a = 0.5 * alpha;
    this.line(m, m, m + L, m, a);
    this.line(m, m, m, m + L, a);
    this.line(w - m, m, w - m - L, m, a);
    this.line(w - m, m, w - m, m + L, a);
    this.line(m, h - m, m + L, h - m, a);
    this.line(m, h - m, m, h - m - L, a);
    this.line(w - m, h - m, w - m - L, h - m, a);
    this.line(w - m, h - m, w - m, h - m - L, a);
  }

  /** Map scale bar (bottom-left) and north arrow. */
  mapLegend(mpp: number, alpha: number, northX: number, northY: number): void {
    if (alpha <= 0) return;
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 5000];
    const target = 150 * mpp;
    const len = nice.reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best), nice[0]);
    const px = len / mpp;
    const x = 40;
    const y = this.h - 44;
    const a = alpha;
    this.line(x, y, x + px, y, 0.8 * a);
    for (let i = 0; i <= 4; i++) this.line(x + (px * i) / 4, y, x + (px * i) / 4, y - (i % 2 ? 4 : 7), 0.8 * a);
    this.text('0', x, y + 12, 9.5, { align: 'center', a: 0.7 * a });
    this.text(len >= 1000 ? `${len / 1000} km` : `${len} m`, x + px, y + 12, 9.5, { align: 'center', a: 0.7 * a });
    this.text('CONTOUR INTERVAL 10 m', x, y - 20, 9.5, { a: 0.55 * a, spacing: 1.5 });

    // north arrow
    const nx = northX;
    const ny = northY;
    const g = this.g;
    g.fillStyle = this.ink(0.85 * a);
    g.beginPath();
    g.moveTo(nx, ny - 14);
    g.lineTo(nx + 5, ny + 6);
    g.lineTo(nx, ny + 2);
    g.closePath();
    g.fill();
    g.strokeStyle = this.ink(0.85 * a);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(nx, ny - 14);
    g.lineTo(nx - 5, ny + 6);
    g.lineTo(nx, ny + 2);
    g.closePath();
    g.stroke();
    this.text('N', nx, ny + 18, 10, { align: 'center', a: 0.8 * a });
  }

  /** Crosshair with elevation readout under the mouse on the title map. */
  probe(x: number, y: number, elevation: number, alpha: number): void {
    if (alpha <= 0) return;
    const a = alpha;
    this.line(x - 14, y, x - 4, y, 0.8 * a);
    this.line(x + 4, y, x + 14, y, 0.8 * a);
    this.line(x, y - 14, x, y - 4, 0.8 * a);
    this.line(x, y + 4, x, y + 14, 0.8 * a);
    this.text(`${Math.round(elevation).toString().padStart(4, '0')} m`, x + 18, y - 12, 10.5, { a: 0.9 * a });
  }

  flight(f: FlightInfo, reveal: number, now: number): void {
    const { w, h } = this;
    const stage = (i: number) => easeOutCubic(clamp01(reveal * 4 - i * 0.45));
    const cy = h / 2;
    const tapeH = Math.min(300, h * 0.42);

    this.corners(stage(0));

    // ---- top-left: score
    let a = stage(0);
    if (a > 0) {
      const x = 40 - (1 - a) * 20;
      this.text('SCORE', x, 44, 10, { a: 0.55 * a, spacing: 3 });
      this.text(fmt.score(f.score), x - 2, 76, 34, { font: SANS, weight: 200, a, spacing: 1 });
      this.text(`DIST  ${fmt.km(f.distance)}`, x, 108, 10.5, { a: 0.7 * a, spacing: 1.5 });
      this.text(`TIME  ${fmt.time(f.time)}`, x, 124, 10.5, { a: 0.7 * a, spacing: 1.5 });
    }

    // ---- under the score: this sheet's missions
    a = stage(2);
    if (a > 0) this.missionList(40 - (1 - a) * 20, 150, f.missions, a);

    // ---- top-center: the clock
    a = stage(1);
    if (a > 0) this.clock(w / 2, 46 - (1 - a) * 16, f.clock, a, now);

    // ---- top-right: best / sheet
    a = stage(1);
    if (a > 0) {
      const x = w - 40 + (1 - a) * 20;
      this.text('BEST', x, 44, 10, { a: 0.55 * a, align: 'right', spacing: 3 });
      this.text(fmt.score(Math.max(f.best, f.score)), x, 64, 15, { a: 0.85 * a, align: 'right', spacing: 1 });
      this.text(`SHEET ${fmt.sheet(f.sheet)}`, x, 86, 10, { a: 0.5 * a, align: 'right', spacing: 2 });
    }

    // ---- altitude tape (left)
    a = stage(1);
    if (a > 0) this.altTape(66 - (1 - a) * 30, cy, tapeH, f, a);

    // ---- speed tape (right)
    a = stage(2);
    if (a > 0) this.speedTape(w - 66 + (1 - a) * 30, cy, tapeH, f, a);

    // ---- heading tape (bottom)
    a = stage(2);
    if (a > 0) this.headingTape(w / 2, h - 46 + (1 - a) * 20, Math.min(360, w * 0.34), f.yaw, a);

    // ---- low multiplier
    a = stage(3);
    if (a > 0) this.multiplier(w / 2, h - 104, f.mult, f.chain, a, now);

    // ---- flight path marker
    if (f.fpm && stage(3) > 0) this.fpm(f.fpm[0], f.fpm[1], stage(3));

    // ---- radar frame
    a = stage(3);
    if (a > 0) this.radarFrame(f, a);

    // ---- speed lines
    if (f.rush > 0) this.speedLines(f.rush * stage(3), now);

    // ---- warnings
    const blink = Math.floor(now * 4) % 2 === 0;
    if (f.terrain && blink) this.warning('TERRAIN', 'PULL UP', w / 2, h * 0.28);
    else if (f.stall && blink) this.warning('STALL', 'NOSE DOWN', w / 2, h * 0.28);

    this.drawPops(w / 2, h * 0.38);
    this.drawBanner(w / 2, Math.max(150, h * 0.2));
  }

  private clock(cx: number, y: number, c: ClockInfo, a: number, now: number): void {
    const warn = c.remaining <= 10;
    const blink = warn && c.remaining > 0 ? 0.55 + 0.45 * Math.cos(now * Math.PI * 4) : 1;
    this.text('TIME LEFT', cx, y - 14, 9.5, { a: 0.55 * a, align: 'center', spacing: 3 });
    this.text(clockText(c.remaining), cx, y + 12, warn ? 34 : 30, { font: SANS, weight: warn ? 300 : 200, a: a * blink, align: 'center', spacing: 1 });
    if (warn) {
      // brackets close in as the time runs out
      const half = 100 - (10 - c.remaining) * 2.2;
      for (const s of [-1, 1]) {
        this.line(cx + s * half, y - 4, cx + s * half, y + 28, 0.9 * a * blink, 1.5);
        this.line(cx + s * half, y - 4, cx + s * (half - 7), y - 4, 0.9 * a * blink, 1.5);
        this.line(cx + s * half, y + 28, cx + s * (half - 7), y + 28, 0.9 * a * blink, 1.5);
      }
    }
    this.text(`SECTOR ${String(c.sector).padStart(2, '0')}  ·  CP ${fmt.km(c.toNext)}`, cx, y + 42, 10, { a: 0.7 * a, align: 'center', spacing: 2 });
    if (c.addedAge < 1.6 && c.added > 0) {
      const t = c.addedAge / 1.6;
      this.text(`+${c.added.toFixed(1)}`, cx + 74, y + 8 - easeOutCubic(t) * 14, 15, { a: a * (1 - t * t), spacing: 1 });
    }
  }

  private missionList(x: number, y: number, list: MissionLine[], a: number): void {
    const g = this.g;
    list.forEach((m, i) => {
      const yy = y + i * 20;
      const done = m.done || m.progress >= 1;
      // marker: filled diamond when done
      g.beginPath();
      g.moveTo(x + 4, yy - 4.5);
      g.lineTo(x + 8.5, yy);
      g.lineTo(x + 4, yy + 4.5);
      g.lineTo(x - 0.5, yy);
      g.closePath();
      if (done) {
        g.fillStyle = this.ink(0.95 * a);
        g.fill();
      } else {
        g.strokeStyle = this.ink(0.7 * a);
        g.lineWidth = 1;
        g.stroke();
      }
      this.text(m.label, x + 16, yy, 11, { font: SANS, weight: 300, a: (done ? 0.95 : 0.75) * a, spacing: 0.5 });
      this.line(x + 16, yy + 10, x + 196, yy + 10, 0.18 * a);
      this.line(x + 16, yy + 10, x + 16 + 180 * Math.min(1, m.progress), yy + 10, 0.85 * a, done ? 1.5 : 1);
    });
  }

  private speedLines(k: number, now: number): void {
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const diag = Math.hypot(w, h) / 2;
    const frame = Math.floor(now * 14);
    const rnd = (i: number, j: number) => {
      const v = Math.sin(i * 127.1 + j * 311.7 + frame * 74.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const n = Math.round(10 + 26 * k);
    for (let i = 0; i < n; i++) {
      const ang = rnd(i, 1) * Math.PI * 2;
      const r0 = diag * (0.55 + 0.25 * rnd(i, 2));
      const len = 40 + 140 * k * rnd(i, 3);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      this.line(cx + c * r0, cy + s * r0, cx + c * (r0 + len), cy + s * (r0 + len), 0.22 * k * (0.4 + 0.6 * rnd(i, 4)));
    }
  }

  /** TIME UP box shown while the run ends on the clock. */
  timeUp(alpha: number, now: number): void {
    if (alpha <= 0) return;
    if (Math.floor(now * 3) % 2 === 0) this.warning('TIME UP', '時間切れ', this.w / 2, this.h * 0.32);
  }

  /** A larger notice under the clock (checkpoints, missions). */
  banner(title: string, lines: string[]): void {
    this.bannerNow = { title, lines, age: 0 };
  }

  private drawBanner(cx: number, cy: number): void {
    const b = this.bannerNow;
    if (!b) return;
    const t = b.age;
    const a = t < 0.15 ? t / 0.15 : t > BANNER_TIME - 0.6 ? Math.max(0, (BANNER_TIME - t) / 0.6) : 1;
    const grow = easeOutCubic(clamp01(t / 0.5));
    this.line(cx - 120 * grow, cy - 22, cx + 120 * grow, cy - 22, 0.6 * a);
    this.text(b.title, cx, cy, 20, { font: SANS, weight: 300, a, align: 'center', spacing: 6 });
    b.lines.forEach((l, i) => this.text(l, cx, cy + 26 + i * 18, 11, { font: SANS, weight: 300, a: (i === 0 ? 0.95 : 0.75) * a, align: 'center', spacing: 1.5 }));
  }

  private altTape(x: number, cy: number, H: number, f: FlightInfo, a: number): void {
    const g = this.g;
    const ppm = 2.2;
    const half = H / 2;
    const yOf = (alt: number) => cy - (alt - f.alt) * ppm;

    // ground hatch below terrain height
    const gy = yOf(f.ground);
    if (gy < cy + half) {
      g.save();
      g.beginPath();
      g.rect(x - 12, Math.max(gy, cy - half), 12, cy + half - Math.max(gy, cy - half));
      g.clip();
      g.strokeStyle = this.ink(0.45 * a);
      g.lineWidth = 1;
      for (let yy = gy - 20; yy < cy + half + 20; yy += 5) {
        g.beginPath();
        g.moveTo(x - 12, yy + 12);
        g.lineTo(x, yy);
        g.stroke();
      }
      g.restore();
      this.line(x - 16, gy, x + 4, gy, 0.9 * a);
    }

    this.line(x, cy - half, x, cy + half, 0.35 * a);
    const lo = Math.floor((f.alt - half / ppm) / 10) * 10;
    const hi = f.alt + half / ppm;
    for (let m = lo; m <= hi; m += 10) {
      const y = yOf(m);
      if (y < cy - half || y > cy + half) continue;
      const fade = 1 - Math.pow(Math.abs(y - cy) / half, 3);
      const major = m % 50 === 0;
      this.line(x, y, x + (major ? 12 : 6), y, (major ? 0.8 : 0.45) * a * fade);
      if (major && Math.abs(y - cy) > 16) this.text(String(m), x + 17, y, 9.5, { a: 0.6 * a * fade });
    }

    // vertical speed bar
    const vy = Math.max(-20, Math.min(20, f.vy));
    this.line(x - 5, cy, x - 5, cy - vy * 4, 0.9 * a, 2);

    // readout (backed so it stays legible over bright ridges)
    this.g.fillStyle = this.bg(0.6 * a);
    const showAir = Math.abs(f.air) > 0.3;
    this.g.fillRect(x + 38, cy - 32, 84, showAir ? 78 : 64);
    this.line(x - 8, cy, x + 40, cy, 0.9 * a);
    this.text(String(Math.round(f.alt)).padStart(4, '0'), x + 44, cy, 20, { a, weight: 300 });
    this.text('ALT  m', x + 45, cy - 22, 9, { a: 0.5 * a, spacing: 2 });
    this.text(`AGL ${Math.max(0, f.agl).toFixed(0).padStart(3, '0')}`, x + 45, cy + 22, 10, { a: 0.75 * a, spacing: 1 });
    if (showAir) {
      const up = f.air > 0;
      this.text(`AIR ${up ? '↑' : '↓'}${Math.abs(f.air).toFixed(1)}`, x + 45, cy + 38, 10, { a: (up ? 0.95 : 0.7) * a, spacing: 1 });
    }
  }

  private speedTape(x: number, cy: number, H: number, f: FlightInfo, a: number): void {
    const kmh = f.speed * 3.6;
    const ppu = 2.4;
    const half = H / 2;
    const yOf = (v: number) => cy - (v - kmh) * ppu;

    // stall zone hatch
    const sy = yOf(21 * 3.6);
    if (sy < cy + half) {
      const g = this.g;
      g.save();
      g.beginPath();
      g.rect(x, Math.max(sy, cy - half), 12, cy + half - Math.max(sy, cy - half));
      g.clip();
      g.strokeStyle = this.ink(0.4 * a);
      for (let yy = sy - 20; yy < cy + half + 20; yy += 5) {
        g.beginPath();
        g.moveTo(x, yy + 12);
        g.lineTo(x + 12, yy);
        g.stroke();
      }
      g.restore();
    }

    this.line(x, cy - half, x, cy + half, 0.35 * a);
    const lo = Math.floor((kmh - half / ppu) / 10) * 10;
    const hi = kmh + half / ppu;
    for (let v = lo; v <= hi; v += 10) {
      if (v < 0) continue;
      const y = yOf(v);
      if (y < cy - half || y > cy + half) continue;
      const fade = 1 - Math.pow(Math.abs(y - cy) / half, 3);
      const major = v % 50 === 0;
      this.line(x, y, x - (major ? 12 : 6), y, (major ? 0.8 : 0.45) * a * fade);
      if (major && Math.abs(y - cy) > 16) this.text(String(v), x - 17, y, 9.5, { a: 0.6 * a * fade, align: 'right' });
    }
    this.g.fillStyle = this.bg(0.6 * a);
    this.g.fillRect(x - 116, cy - 32, 78, 50);
    this.line(x - 40, cy, x + 8, cy, 0.9 * a);
    this.text(String(Math.round(kmh)).padStart(3, '0'), x - 44, cy, 20, { a, weight: 300, align: 'right' });
    this.text('SPD  km/h', x - 45, cy - 22, 9, { a: 0.5 * a, align: 'right', spacing: 2 });
  }

  private headingTape(cx: number, y: number, W: number, yaw: number, a: number): void {
    const deg = ((yaw * 180) / Math.PI + 360) % 360;
    const ppd = 2.2;
    const half = W / 2;
    this.line(cx - half, y, cx + half, y, 0.3 * a);
    const lo = Math.floor((deg - half / ppd) / 5) * 5;
    for (let d = lo; d <= deg + half / ppd; d += 5) {
      const x = cx + (d - deg) * ppd;
      if (x < cx - half || x > cx + half) continue;
      const fade = 1 - Math.pow(Math.abs(x - cx) / half, 3);
      const n = ((d % 360) + 360) % 360;
      const major = n % 30 === 0;
      this.line(x, y, x, y - (major ? 9 : 4), (major ? 0.8 : 0.4) * a * fade);
      if (major) {
        const label = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[n] ?? String(n).padStart(3, '0');
        this.text(label, x, y + 12, 9.5, { a: 0.65 * a * fade, align: 'center' });
      }
    }
    const g = this.g;
    g.fillStyle = this.ink(a);
    g.beginPath();
    g.moveTo(cx, y - 12);
    g.lineTo(cx - 4, y - 19);
    g.lineTo(cx + 4, y - 19);
    g.closePath();
    g.fill();
    this.text(`HDG ${Math.round(deg).toString().padStart(3, '0')}`, cx, y - 30, 10, { a: 0.8 * a, align: 'center', spacing: 2 });
  }

  private multiplier(cx: number, y: number, mult: number, chain: number, a: number, now: number): void {
    const segW = 22;
    const gap = 4;
    const total = segW * 4 + gap * 3;
    const x0 = cx - total / 2;
    for (let i = 0; i < 4; i++) {
      const on = i < mult;
      const x = x0 + i * (segW + gap);
      if (on) {
        const g = this.g;
        g.fillStyle = this.ink((mult === 4 ? 0.75 + 0.25 * Math.sin(now * 14) : 0.9) * a);
        g.fillRect(x, y - 2, segW, 4);
      } else {
        this.line(x, y, x + segW, y, 0.25 * a);
      }
    }
    this.text(`LOW ×${mult}`, cx - total / 2 - 12, y, 10.5, { a: (mult > 1 ? 1 : 0.45) * a, align: 'right', spacing: 2 });
    this.text(chain > 0 ? `CHAIN ×${chain}` : 'CHAIN —', cx + total / 2 + 12, y, 10.5, { a: (chain > 0 ? 1 : 0.45) * a, spacing: 2 });
  }

  private fpm(x: number, y: number, a: number): void {
    const g = this.g;
    g.strokeStyle = this.ink(0.85 * a);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.stroke();
    this.line(x - 15, y, x - 6, y, 0.85 * a, 1.2);
    this.line(x + 6, y, x + 15, y, 0.85 * a, 1.2);
    this.line(x, y - 6, x, y - 11, 0.85 * a, 1.2);
  }

  private radarFrame(f: FlightInfo, a: number): void {
    const r = f.radar;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const R = r.w / 2;
    const g = this.g;

    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    // thermals
    g.setLineDash([2, 3]);
    for (const t of f.thermals) {
      const [sx, sy] = mapToScreen(r, t.x, t.z);
      g.strokeStyle = this.ink(0.8 * a);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx, sy, Math.max(t.radius / r.mpp, 2.5), 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    // gates
    for (const gt of f.gates) {
      const [sx, sy] = mapToScreen(r, gt.x, gt.z);
      const [ex, ey] = mapToScreen(r, gt.x + gt.nz * 30, gt.z - gt.nx * 30);
      const dx = ex - sx;
      const dy = ey - sy;
      this.line(sx - dx, sy - dy, sx + dx, sy + dy, (gt.next ? 1 : 0.5) * a, gt.next ? 2 : 1);
    }
    // next checkpoint: a dashed line across the map
    if (f.cpZ !== null) {
      const [ax, ay] = mapToScreen(r, f.x - 2000, f.cpZ);
      const [bx, by] = mapToScreen(r, f.x + 2000, f.cpZ);
      g.setLineDash([5, 3]);
      this.line(ax, ay, bx, by, 0.85 * a, 1.2);
      g.setLineDash([]);
    }
    g.restore();

    this.windGauge(r.x - 40, cy - R * 0.35, f, a);

    // bezel
    g.strokeStyle = this.ink(0.55 * a);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2 - r.heading;
      const major = i % 9 === 0;
      const r1 = R + 3;
      const r2 = R + (major ? 9 : 5);
      this.line(cx + Math.sin(ang) * r1, cy - Math.cos(ang) * r1, cx + Math.sin(ang) * r2, cy - Math.cos(ang) * r2, (major ? 0.8 : 0.35) * a);
    }
    const nAng = -r.heading;
    this.text('N', cx + Math.sin(nAng) * (R + 18), cy - Math.cos(nAng) * (R + 18), 10, { a: 0.9 * a, align: 'center' });
    this.text(`${Math.round((r.w / 2) * r.mpp)} m`, cx, cy + R + 16, 9, { a: 0.5 * a, align: 'center', spacing: 1.5 });

    // player glyph
    g.fillStyle = this.ink(a);
    g.strokeStyle = this.bg(0.9 * a);
    g.beginPath();
    g.moveTo(cx, cy - 7);
    g.lineTo(cx + 5, cy + 5);
    g.lineTo(cx, cy + 2);
    g.lineTo(cx - 5, cy + 5);
    g.closePath();
    g.fill();
    g.stroke();
  }

  /** Wind direction as seen on the (heading-up) radar, with its speed. */
  private windGauge(cx: number, cy: number, f: FlightInfo, a: number): void {
    const r = f.radar;
    const speed = Math.hypot(f.wind.x, f.wind.z);
    const g = this.g;
    g.strokeStyle = this.ink(0.3 * a);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, 15, 0, Math.PI * 2);
    g.stroke();
    if (speed > 0.3) {
      const [ox, oy] = mapToScreen(r, f.x, f.z);
      const [ex, ey] = mapToScreen(r, f.x + f.wind.x, f.z + f.wind.z);
      const len = Math.hypot(ex - ox, ey - oy) || 1;
      const ux = (ex - ox) / len;
      const uy = (ey - oy) / len;
      const L = 11;
      this.line(cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L, 0.95 * a, 1.5);
      g.fillStyle = this.ink(0.95 * a);
      g.beginPath();
      g.moveTo(cx + ux * (L + 2), cy + uy * (L + 2));
      g.lineTo(cx + ux * (L - 5) - uy * 4.5, cy + uy * (L - 5) + ux * 4.5);
      g.lineTo(cx + ux * (L - 5) + uy * 4.5, cy + uy * (L - 5) - ux * 4.5);
      g.closePath();
      g.fill();
    }
    this.text('WIND', cx, cy + 27, 9, { a: 0.55 * a, align: 'center', spacing: 2 });
    this.text(`${Math.round(speed)} m/s`, cx, cy + 40, 10, { a: 0.85 * a, align: 'center', spacing: 1 });
  }

  private warning(word: string, sub: string, cx: number, cy: number): void {
    const g = this.g;
    g.font = `500 14px ${MONO}`;
    const tw = g.measureText(word).width + word.length * 4 + 28;
    g.fillStyle = this.ink(0.95);
    g.fillRect(cx - tw / 2, cy - 14, tw, 28);
    g.fillStyle = this.bg(1);
    g.textAlign = 'center';
    if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '4px';
    g.fillText(word, cx + 2, cy + 1);
    if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
    this.text(sub, cx, cy + 28, 10, { a: 0.8, align: 'center', spacing: 3 });
  }

  pop(text: string, sub: string): void {
    this.pops.push({ text, sub, age: 0 });
    if (this.pops.length > 3) this.pops.shift();
  }

  updatePops(dt: number): void {
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < 1.4);
    if (this.bannerNow) {
      this.bannerNow.age += dt;
      if (this.bannerNow.age > BANNER_TIME) this.bannerNow = null;
    }
  }

  clearNotices(): void {
    this.pops = [];
    this.bannerNow = null;
  }

  private drawPops(cx: number, cy: number): void {
    for (const p of this.pops) {
      const t = p.age / 1.4;
      const a = t < 0.1 ? t / 0.1 : 1 - Math.pow((t - 0.1) / 0.9, 2);
      const y = cy - easeOutCubic(t) * 28;
      const s = 1 + 0.25 * Math.max(0, 1 - t * 6);
      this.text(p.text, cx, y, 22 * s, { font: SANS, weight: 200, a, align: 'center', spacing: 2 });
      this.text(p.sub, cx, y + 22, 10, { a: 0.8 * a, align: 'center', spacing: 3 });
    }
  }

  /** Flight path over the result map, drawn progressively. */
  path(frame: MapFrame, pts: PathPoint[], progress: number, gates: PathPoint[], alpha: number): void {
    if (pts.length < 2 || alpha <= 0) return;
    const g = this.g;
    const n = Math.max(2, Math.floor(pts.length * clamp01(progress)));
    const scr = pts.slice(0, n).map((p) => mapToScreen(frame, p.x, p.z));

    // under-stroke in background color keeps the path legible over contours
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = this.bg(0.85 * alpha);
    g.lineWidth = 5;
    g.beginPath();
    scr.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.strokeStyle = this.ink(alpha);
    g.lineWidth = 1.6;
    g.stroke();
    g.lineCap = 'butt';

    // start
    const [sx, sy] = scr[0];
    g.strokeStyle = this.ink(alpha);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(sx, sy, 5, 0, Math.PI * 2);
    g.stroke();
    this.text('START', sx + 10, sy + 1, 9.5, { a: 0.8 * alpha, spacing: 2 });

    // km marks
    let acc = 0;
    let nextKm = 1000;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      acc += d;
      if (acc >= nextKm) {
        const [x, y] = scr[i];
        g.fillStyle = this.ink(alpha);
        g.fillRect(x - 2, y - 2, 4, 4);
        this.text(`${nextKm / 1000}`, x + 7, y - 7, 9.5, { a: 0.75 * alpha });
        nextKm += 1000;
      }
    }

    // gates passed
    for (const gp of gates) {
      const [x, y] = mapToScreen(frame, gp.x, gp.z);
      g.strokeStyle = this.ink(0.7 * alpha);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.stroke();
    }

    // crash mark
    if (progress >= 1) {
      const [x, y] = scr[scr.length - 1];
      this.line(x - 7, y - 7, x + 7, y + 7, alpha, 1.6);
      this.line(x - 7, y + 7, x + 7, y - 7, alpha, 1.6);
    }
  }
}
