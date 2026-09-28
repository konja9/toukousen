import { ECHO, FIELD } from '../config';
import type { SectorLog } from '../sim/run';

/**
 * Small chart of a finished sector for the dive log, drawn on the CPU with
 * marching squares over the echo grid: isobaths only where the sector was
 * charted, the layer isobath dashed, the track, entry and exit.
 */
export function drawLog(c: HTMLCanvasElement, log: SectorLog, ink: string, bg: string): void {
  const size = 220;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = size * dpr;
  c.height = size * dpr;
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const GN = ECHO.N;
  const GS = ECHO.spacing;
  const H = FIELD.half;
  const k = size / (2 * H);
  const X = (x: number) => (x + H) * k;
  const fl = log.floor;
  const ch = log.charted;
  // unknown sea: dots
  g.fillStyle = ink;
  g.globalAlpha = 0.25;
  for (let z = -H + 25; z < H; z += 25) for (let x = -H + 25; x < H; x += 25) g.fillRect(X(x) - 0.5, X(z) - 0.5, 1, 1);
  g.globalAlpha = 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of fl) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const levels: Array<[number, number, boolean]> = [];
  for (let L = Math.ceil(lo / 10) * 10; L <= hi; L += 10) levels.push([L, L % 50 === 0 ? 1.1 : 0.5, false]);
  levels.push([log.layerY, 1.3, true]);
  for (const [L, width, dashed] of levels) {
    g.strokeStyle = ink;
    g.globalAlpha = dashed ? 1 : width > 1 ? 0.85 : 0.5;
    g.lineWidth = width;
    g.setLineDash(dashed ? [3, 3] : []);
    g.beginPath();
    for (let j = 0; j < GN - 1; j++) {
      for (let i = 0; i < GN - 1; i++) {
        const n = j * GN + i;
        if (!(ch[n] || ch[n + 1] || ch[n + GN] || ch[n + GN + 1])) continue;
        const a = fl[n] - L;
        const b = fl[n + 1] - L;
        const cc = fl[n + GN + 1] - L;
        const d = fl[n + GN] - L;
        const pts: Array<[number, number]> = [];
        const x0 = i * GS - H;
        const z0 = j * GS - H;
        if (a > 0 !== b > 0) pts.push([x0 + (a / (a - b)) * GS, z0]);
        if (b > 0 !== cc > 0) pts.push([x0 + GS, z0 + (b / (b - cc)) * GS]);
        if (d > 0 !== cc > 0) pts.push([x0 + (d / (d - cc)) * GS, z0 + GS]);
        if (a > 0 !== d > 0) pts.push([x0, z0 + (a / (a - d)) * GS]);
        for (let p = 0; p + 1 < pts.length; p += 2) {
          g.moveTo(X(pts[p][0]), X(pts[p][1]));
          g.lineTo(X(pts[p + 1][0]), X(pts[p + 1][1]));
        }
      }
    }
    g.stroke();
  }
  g.setLineDash([]);
  g.globalAlpha = 1;
  // track
  g.strokeStyle = ink;
  for (let i = 1; i < log.track.length; i++) {
    const [x0, z0] = log.track[i - 1];
    const [x1, z1, up] = log.track[i];
    g.lineWidth = up ? 2.4 : 1.2;
    g.beginPath();
    g.moveTo(X(x0), X(z0));
    g.lineTo(X(x1), X(z1));
    g.stroke();
  }
  // entry and exit
  g.lineWidth = 1.2;
  const [ex, ez] = log.entry;
  g.beginPath();
  g.moveTo(X(ex), X(ez) - 5);
  g.lineTo(X(ex) - 4, X(ez) + 3);
  g.lineTo(X(ex) + 4, X(ez) + 3);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(X(log.exit[0]), X(log.exit[1]), 5, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(0.5, 0.5, size - 1, size - 1);
}
