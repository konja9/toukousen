import { FIELD } from '../config';
import type { HeightField } from './heightfield';

/** Point features used to place controls, with the description an orienteer would read. */
export type FeatureKind = 'peak' | 'saddle' | 'depression';

export interface Feature {
  kind: FeatureKind;
  x: number;
  z: number;
  h: number;
}

export const FEATURE_TEXT: Record<FeatureKind, { ja: string; en: string }> = {
  peak: { ja: '頂上', en: 'HILLTOP' },
  saddle: { ja: '鞍部', en: 'SADDLE' },
  depression: { ja: '窪地', en: 'DEPRESSION' },
};

/**
 * Find critical points of the surface: where the slope vanishes, classify by
 * the Hessian (both curvatures negative = hilltop, positive = depression,
 * mixed = saddle).
 */
export function findFeatures(field: HeightField, step = 4, margin = 16): Feature[] {
  const H = FIELD.half - margin;
  const out: Feature[] = [];
  const e = 1.5;
  for (let z = -H; z <= H; z += step) {
    for (let x = -H; x <= H; x += step) {
      // refine to the local critical point with a few Newton steps
      let px = x;
      let pz = z;
      let ok = false;
      for (let it = 0; it < 8; it++) {
        const s = field.sample(px, pz);
        const sx1 = field.sample(px + e, pz);
        const sx0 = field.sample(px - e, pz);
        const sz1 = field.sample(px, pz + e);
        const sz0 = field.sample(px, pz - e);
        const hxx = (sx1.gx - sx0.gx) / (2 * e);
        const hzz = (sz1.gz - sz0.gz) / (2 * e);
        const hxz = (sz1.gx - sz0.gx) / (2 * e);
        const det = hxx * hzz - hxz * hxz;
        if (Math.abs(det) < 1e-8) break;
        const ddx = (hzz * s.gx - hxz * s.gz) / det;
        const ddz = (-hxz * s.gx + hxx * s.gz) / det;
        px -= ddx;
        pz -= ddz;
        if (Math.abs(px - x) > step || Math.abs(pz - z) > step) break;
        if (Math.hypot(ddx, ddz) < 0.01) {
          ok = true;
          break;
        }
      }
      if (!ok || Math.abs(px) > H || Math.abs(pz) > H) continue;
      const s = field.sample(px, pz);
      if (Math.hypot(s.gx, s.gz) > 0.01) continue;
      const sx1 = field.sample(px + e, pz);
      const sx0 = field.sample(px - e, pz);
      const sz1 = field.sample(px, pz + e);
      const sz0 = field.sample(px, pz - e);
      const hxx = (sx1.gx - sx0.gx) / (2 * e);
      const hzz = (sz1.gz - sz0.gz) / (2 * e);
      const hxz = (sz1.gx - sz0.gx) / (2 * e);
      const det = hxx * hzz - hxz * hxz;
      const tr = hxx + hzz;
      let kind: FeatureKind;
      if (det > 1e-6 && tr < 0) kind = 'peak';
      else if (det > 1e-6 && tr > 0) kind = 'depression';
      else if (det < -1e-6) kind = 'saddle';
      else continue;
      if (!prominent(field, kind, px, pz, s.h)) continue;
      if (out.some((f) => Math.hypot(f.x - px, f.z - pz) < 6)) continue;
      out.push({ kind, x: px, z: pz, h: s.h });
    }
  }
  return out;
}

/**
 * Keep only features a map reader would notice: a hilltop or depression must
 * stand at least `min` meters above/below a ring around it, and a saddle needs
 * two clear rises and two clear falls on that ring.
 */
function prominent(field: HeightField, kind: FeatureKind, x: number, z: number, h: number, r = 14, min = 2.5): boolean {
  const n = 32;
  const ring: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    ring.push(field.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h);
  }
  if (kind === 'peak') return Math.max(...ring) < -min;
  if (kind === 'depression') return Math.min(...ring) > min;
  // saddle: count sign changes of (ring - 0) with a dead band
  let changes = 0;
  let last = 0;
  for (let k = 0; k < n; k++) {
    const v = ring[k];
    const s = v > min ? 1 : v < -min ? -1 : 0;
    if (s !== 0) {
      if (last !== 0 && s !== last) changes++;
      last = s;
    }
  }
  // close the loop
  const first = ring.map((v) => (v > min ? 1 : v < -min ? -1 : 0)).find((s) => s !== 0) ?? 0;
  if (first !== 0 && last !== 0 && first !== last) changes++;
  return changes >= 4;
}
