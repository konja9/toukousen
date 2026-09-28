import { ECHO, FIELD } from '../config';
import type { P3 } from './los';

/**
 * Cheap lookups on the 4 m echo grid (floor heights sampled from the
 * B-spline surface). Sound checks run thousands of times per ping, so they
 * use bilinear interpolation here instead of the full B-spline.
 */

const GN = ECHO.N;
const GS = ECHO.spacing;
const H = FIELD.half;

export function floorAt(floor: Float32Array, x: number, z: number): number {
  let u = (x + H) / GS;
  let v = (z + H) / GS;
  u = u < 0 ? 0 : u > GN - 1.001 ? GN - 1.001 : u;
  v = v < 0 ? 0 : v > GN - 1.001 ? GN - 1.001 : v;
  const i = u | 0;
  const j = v | 0;
  const fu = u - i;
  const fv = v - j;
  const n = j * GN + i;
  const a = floor[n] + (floor[n + 1] - floor[n]) * fu;
  const b = floor[n + GN] + (floor[n + GN + 1] - floor[n + GN]) * fu;
  return a + (b - a) * fv;
}

/**
 * True when the straight line from a to b stays in the water. The last
 * `skip` meters before b are ignored so a point on the floor can be reached.
 */
export function clearPath(floor: Float32Array, a: P3, b: P3, step = ECHO.losStep, skip = 2.5): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const n = Math.floor((dist - skip) / step);
  for (let k = 1; k <= n; k++) {
    const t = (k * step) / dist;
    if (a.y + dy * t < floorAt(floor, a.x + dx * t, a.z + dz * t)) return false;
  }
  return true;
}

/** True when the segment between a and b crosses the thermocline. */
export const crossesLayer = (ay: number, by: number, layerY: number) => ay > layerY !== by > layerY;
