import { BRUSH } from '../config';
import type { BrushMode, HeightField } from '../field/heightfield';

/** A recorded drag: the brush follows `points` for `seconds`. */
export interface Stroke {
  mode: BrushMode;
  radius: number;
  seconds: number;
  points: ReadonlyArray<readonly [number, number]>;
}

export const TICK = 1 / 60;

/** Position along the polyline at fraction t (0..1) of its length. */
export function pointAt(points: Stroke['points'], t: number): [number, number] {
  if (points.length === 1) return [points[0][0], points[0][1]];
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    lens.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] > 0 ? Math.min(d / lens[i], 1) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
    }
    d -= lens[i];
  }
  return [points[points.length - 1][0], points[points.length - 1][1]];
}

/** Replay a stroke with the same per-tick brush the game uses. */
export function applyStroke(field: HeightField, s: Stroke): void {
  field.pushUndo();
  const ticks = Math.max(1, Math.round(s.seconds / TICK));
  for (let i = 0; i < ticks; i++) {
    const [x, z] = pointAt(s.points, ticks === 1 ? 0 : i / (ticks - 1));
    field.brush(x, z, s.radius, BRUSH.rate * TICK, s.mode);
  }
}
