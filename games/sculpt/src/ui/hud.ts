import { shared } from '../render/uniforms';
import type { Stage } from '../sim/stages';
import { sheetNo, starsFor } from './screens';

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const SANS = "'Inter', 'Noto Sans JP', system-ui, sans-serif";
const JP = "'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif";

export interface HudInfo {
  stage: Stage;
  strokes: number;
  soil: number;
  soilMax: number;
  radius: number;
  mode: 'raise' | 'cut';
  phase: 'edit' | 'roll' | 'other';
  fast: boolean;
  reached: boolean[];
  cursor: { x: number; y: number; h: number } | null;
  canUndo: boolean;
}

/** Canvas-2D overlay for the stage HUD. */
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

  ink(a: number): string {
    return `rgba(${this.inkRGB},${a})`;
  }

  bg(a: number): string {
    return `rgba(${this.bgRGB},${a})`;
  }

  begin(): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.textBaseline = 'middle';
  }

  private text(s: string, x: number, y: number, size: number, o: { font?: string; weight?: number; align?: CanvasTextAlign; a?: number; spacing?: number } = {}): number {
    const g = this.g;
    g.font = `${o.weight ?? 400} ${size}px ${o.font ?? MONO}`;
    g.textAlign = o.align ?? 'left';
    g.fillStyle = this.ink(o.a ?? 1);
    const ls = 'letterSpacing' in g;
    if (ls) (g as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
    g.fillText(s, x, y);
    const w = g.measureText(s).width;
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
    const a = 0.5 * alpha;
    for (const [x, y, dx, dy] of [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ]) {
      this.line(x, y, x + dx * L, y, a);
      this.line(x, y, x, y + dy * L, a);
    }
  }

  /** Wrap text into lines no wider than maxW. */
  private wrap(s: string, maxW: number, size: number): string[] {
    const g = this.g;
    g.font = `300 ${size}px ${JP}`;
    const out: string[] = [];
    let cur = '';
    for (const ch of s) {
      if (g.measureText(cur + ch).width > maxW && cur) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  stage(info: HudInfo, alpha: number, time: number): void {
    if (alpha <= 0) return;
    const { w, h } = this;
    const a = alpha;
    const st = info.stage;
    this.corners(a);

    // ---- top-left: sheet + name + hint
    this.text(`SHEET ${sheetNo(st.id)}`, 40, 44, 10.5, { a: 0.55 * a, spacing: 3 });
    const nw = this.text(st.name, 40, 74, 28, { font: SANS, weight: 200, a, spacing: 3 });
    this.text(st.nameJa, 40 + nw + 16, 77, 13, { font: JP, weight: 300, a: 0.7 * a, spacing: 2 });
    const lines = this.wrap(st.hint, Math.min(420, w * 0.34), 12.5);
    lines.forEach((l, i) => this.text(l, 40, 104 + i * 20, 12.5, { font: JP, weight: 300, a: 0.62 * a, spacing: 0.5 }));

    // ---- top-right: strokes / par / stars
    const rx = w - 40;
    this.text('STROKES', rx, 44, 10.5, { a: 0.55 * a, align: 'right', spacing: 3 });
    this.text(String(info.strokes), rx - 58, 80, 40, { font: SANS, weight: 200, a, align: 'right' });
    this.text(`/ PAR ${st.par}`, rx, 84, 11, { a: 0.6 * a, align: 'right', spacing: 1.5 });
    const stars = starsFor(Math.max(info.strokes, 0), st.par);
    this.text('★'.repeat(stars) + '☆'.repeat(3 - stars), rx, 112, 13, { font: SANS, a: 0.85 * a, align: 'right', spacing: 4 });
    if (st.checkpoints.length) {
      const done = info.reached.filter(Boolean).length;
      this.text(`△ ${done} / ${st.checkpoints.length}  BENCHMARK`, rx, 136, 10.5, { a: 0.7 * a, align: 'right', spacing: 1.5 });
    }

    // ---- left: soil gauge
    const gx = 44;
    const gh = Math.min(220, h * 0.3);
    const gy = h / 2 - gh / 2 + 30;
    this.text('SOIL', gx, gy - 26, 10, { a: 0.55 * a, spacing: 3 });
    this.text(`${Math.round(info.soil)} m³`, gx, gy - 10, 12, { a: 0.9 * a, spacing: 1 });
    this.line(gx, gy, gx, gy + gh, 0.3 * a);
    const frac = info.soilMax > 0 ? Math.min(info.soil / info.soilMax, 1) : 0;
    const g = this.g;
    g.fillStyle = this.ink(0.85 * a);
    g.fillRect(gx - 3, gy + gh * (1 - frac), 6, gh * frac);
    for (let i = 0; i <= 10; i++) this.line(gx + 6, gy + (gh * i) / 10, gx + (i % 5 === 0 ? 14 : 10), gy + (gh * i) / 10, 0.35 * a);

    // ---- bottom-left: brush
    const by = h - 70;
    this.text('BRUSH', 40, by, 10, { a: 0.55 * a, spacing: 3 });
    this.text(`r ${info.radius.toFixed(0)} m`, 40, by + 20, 13, { a: 0.9 * a, spacing: 1 });
    this.text(info.mode === 'raise' ? '＋ 盛土 FILL' : '－ 切土 CUT', 110, by + 20, 12, { font: JP, a: 0.9 * a, spacing: 1 });

    // ---- bottom-center: phase
    const cx = w / 2;
    if (info.phase === 'edit') {
      this.text('SPACE で球を放す', cx, h - 64, 12.5, { font: JP, a: 0.85 * a, align: 'center', spacing: 2 });
      this.text(`左 盛土 · 右 切土 · ホイール 大きさ · Z 戻す${info.canUndo ? '' : ''} · R 最初から · Q/E 回転 · V 真上`, cx, h - 40, 11, { font: JP, a: 0.5 * a, align: 'center', spacing: 1 });
    } else if (info.phase === 'roll') {
      const blink = 0.6 + 0.4 * Math.sin(time * 6);
      this.text(info.fast ? 'ROLLING  ×4' : 'ROLLING', cx, h - 64, 12.5, { a: blink * a, align: 'center', spacing: 5 });
      this.text('F 早送り · SPACE 止めて編集に戻る', cx, h - 40, 11, { font: JP, a: 0.5 * a, align: 'center', spacing: 1 });
    }

    // ---- cursor readout
    const c = info.cursor;
    if (c && info.phase === 'edit') {
      const label = `${c.h.toFixed(1)} m`;
      g.font = `400 11px ${MONO}`;
      const tw = g.measureText(label).width;
      g.fillStyle = this.bg(0.7 * a);
      g.fillRect(c.x + 14, c.y - 26, tw + 12, 18);
      this.text(label, c.x + 20, c.y - 17, 11, { a });
      this.text(info.mode === 'raise' ? '+' : '−', c.x - 16, c.y - 16, 14, { a, align: 'center' });
    }
  }
}
