import { FIELD } from '../config';
import { HeightField } from '../field/heightfield';
import type { Stage } from '../sim/stages';

/**
 * Stage-select thumbnails drawn on the CPU with marching squares over the
 * stage's initial surface: a small printed contour sheet per stage.
 */
export function drawThumb(canvas: HTMLCanvasElement, stage: Stage, ink: string, bg: string): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const size = canvas.width;
  const field = new HeightField();
  field.fill(stage.terrain, stage.rock);
  const n = 96;
  const H = FIELD.half;
  const toW = (i: number) => (i / n) * 2 * H - H;
  const grid = new Float32Array((n + 1) * (n + 1));
  const rock = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const s = field.sample(toW(i), toW(j));
      grid[j * (n + 1) + i] = s.h;
      rock[j * (n + 1) + i] = s.rock;
    }
  }
  const px = size / n;
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // water
  if (stage.water !== null) {
    g.strokeStyle = ink;
    g.globalAlpha = 0.28;
    g.lineWidth = 1;
    for (let j = 0; j <= n; j += 2) {
      for (let i = 0; i < n; i++) {
        if (grid[j * (n + 1) + i] < stage.water) {
          g.beginPath();
          g.moveTo(i * px, j * px);
          g.lineTo((i + 1) * px, j * px);
          g.stroke();
        }
      }
    }
  }
  // bedrock stipple
  g.fillStyle = ink;
  g.globalAlpha = 0.45;
  for (let j = 0; j <= n; j += 3) {
    for (let i = 0; i <= n; i += 3) {
      if (rock[j * (n + 1) + i] > 0.5) g.fillRect(i * px - 0.5, j * px - 0.5, 1, 1);
    }
  }

  // contours by marching squares
  const lo = Math.floor(Math.min(...grid));
  const hi = Math.ceil(Math.max(...grid));
  for (let level = lo; level <= hi; level += FIELD.interval) {
    const major = level % (FIELD.interval * FIELD.indexEvery) === 0;
    g.globalAlpha = major ? 0.95 : 0.42;
    g.lineWidth = major ? 1.2 : 0.7;
    g.strokeStyle = ink;
    g.beginPath();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = grid[j * (n + 1) + i];
        const b = grid[j * (n + 1) + i + 1];
        const c = grid[(j + 1) * (n + 1) + i + 1];
        const d = grid[(j + 1) * (n + 1) + i];
        const pts: Array<[number, number]> = [];
        const edge = (v0: number, v1: number, x0: number, y0: number, x1: number, y1: number) => {
          if ((v0 < level) !== (v1 < level)) {
            const t = (level - v0) / (v1 - v0);
            pts.push([(x0 + (x1 - x0) * t) * px, (y0 + (y1 - y0) * t) * px]);
          }
        };
        edge(a, b, i, j, i + 1, j);
        edge(b, c, i + 1, j, i + 1, j + 1);
        edge(c, d, i + 1, j + 1, i, j + 1);
        edge(d, a, i, j + 1, i, j);
        for (let k = 0; k + 1 < pts.length; k += 2) {
          g.moveTo(pts[k][0], pts[k][1]);
          g.lineTo(pts[k + 1][0], pts[k + 1][1]);
        }
      }
    }
    g.stroke();
  }

  const toPx = (x: number) => ((x + H) / (2 * H)) * size;
  g.globalAlpha = 1;
  // start
  g.fillStyle = ink;
  g.beginPath();
  g.arc(toPx(stage.start[0]), toPx(stage.start[1]), 3.2, 0, Math.PI * 2);
  g.fill();
  // goal
  g.strokeStyle = ink;
  g.lineWidth = 1.2;
  for (const r of [3, 6]) {
    g.beginPath();
    g.arc(toPx(stage.goal[0]), toPx(stage.goal[1]), r, 0, Math.PI * 2);
    g.stroke();
  }
  // benchmarks
  for (const [x, z] of stage.checkpoints) {
    const cx = toPx(x);
    const cy = toPx(z);
    g.beginPath();
    g.moveTo(cx, cy - 5);
    g.lineTo(cx + 4.5, cy + 3.5);
    g.lineTo(cx - 4.5, cy + 3.5);
    g.closePath();
    g.stroke();
  }
}
