import type { Ray } from 'three';
import { FIELD } from '../config';
import type { HeightField } from './heightfield';

/** First intersection of a ray with the terrain surface inside the model, or null. */
export function pickTerrain(ray: Ray, field: HeightField): [number, number, number] | null {
  const o = ray.origin;
  const d = ray.direction;
  const H = FIELD.half;
  // clip the ray to the model's bounding box
  let t0 = 0;
  let t1 = 1e4;
  const lo = [-H, FIELD.base, -H];
  const hi = [H, FIELD.maxH + 1, H];
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(da[k]) < 1e-9) {
      if (oa[k] < lo[k] || oa[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - oa[k]) / da[k];
    let b = (hi[k] - oa[k]) / da[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  const above = (t: number) => o.y + d.y * t - field.heightAt(o.x + d.x * t, o.z + d.z * t);
  const step = 0.4;
  let prev = t0;
  if (above(prev) < 0) return null;
  for (let t = t0 + step; t <= t1 + step; t += step) {
    const tt = Math.min(t, t1);
    if (above(tt) <= 0) {
      let a = prev;
      let b = tt;
      for (let i = 0; i < 16; i++) {
        const m = (a + b) / 2;
        if (above(m) > 0) a = m;
        else b = m;
      }
      const x = o.x + d.x * b;
      const z = o.z + d.z * b;
      return [x, field.heightAt(x, z), z];
    }
    prev = tt;
    if (tt >= t1) break;
  }
  return null;
}
