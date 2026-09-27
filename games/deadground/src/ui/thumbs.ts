import { FIELD } from '../config';
import { generate } from '../field/generate';
import type { Course } from '../sim/course';

/** Sheet-index thumbnails: marching-squares contours plus the course overprint. */
export function drawThumb(canvas: HTMLCanvasElement, course: Course, ink: string, bg: string): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const size = canvas.width;
  const field = generate(course.terrain);
  const n = 110;
  const H = FIELD.half;
  const grid = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid[j * (n + 1) + i] = field.heightAt((i / n) * 2 * H - H, (j / n) * 2 * H - H);
  const px = size / n;
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = ink;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of grid) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let level = Math.ceil(lo / FIELD.interval) * FIELD.interval; level <= hi; level += FIELD.interval) {
    const major = level % (FIELD.interval * FIELD.indexEvery) === 0;
    g.globalAlpha = major ? 0.9 : 0.4;
    g.lineWidth = major ? 1.1 : 0.6;
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
  const to = (v: number) => ((v + H) / (2 * H)) * size;
  g.globalAlpha = 1;
  g.lineWidth = 1.2;
  const pts: Array<[number, number]> = [[to(course.start[0]), to(course.start[1])], ...course.controls.map((c) => [to(c.x), to(c.z)] as [number, number]), [to(course.finish[0]), to(course.finish[1])]];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.globalAlpha = 0.55;
  g.stroke();
  g.globalAlpha = 1;
  for (const [x, y] of pts.slice(1, -1)) {
    g.fillStyle = bg;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = ink;
  for (const w of course.watchers) {
    if (w.kind === 'tower') g.fillRect(to(w.x) - 3, to(w.z) - 3, 6, 6);
    else {
      g.beginPath();
      g.arc(to(w.path[0][0]), to(w.path[0][1]), 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}
