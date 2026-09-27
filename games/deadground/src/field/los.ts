import { WATCH } from '../config';
import type { HeightField } from './heightfield';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/**
 * True when the straight line from `a` to `b` stays above the ground.
 * The ray is marched in horizontal steps; the last `skip` meters near the
 * target are ignored so a point standing on the ground can still be seen.
 */
export function lineOfSight(field: HeightField, a: P3, b: P3, step: number = WATCH.losStep, skip = 1): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const n = Math.floor((dist - skip) / step);
  for (let k = 1; k <= n; k++) {
    const t = (k * step) / dist;
    const y = a.y + (b.y - a.y) * t;
    if (y < field.heightAt(a.x + dx * t, a.z + dz * t)) return false;
  }
  return true;
}
