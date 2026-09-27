import { describe, expect, it } from 'vitest';
import { FIELD } from '../src/config';
import { findFeatures } from '../src/field/features';
import { HeightField } from '../src/field/heightfield';
import { lineOfSight } from '../src/field/los';

const make = (fn: (x: number, z: number) => number) => {
  const f = new HeightField();
  f.fill(fn);
  return f;
};

describe('HeightField', () => {
  it('reproduces planes and their slope at 2 m spacing', () => {
    const f = make((x, z) => 30 + 0.2 * x - 0.1 * z);
    for (const [x, z] of [[0, 0], [13.7, -81.2], [-200.5, 150.25]]) {
      const s = f.sample(x, z);
      expect(s.h).toBeCloseTo(30 + 0.2 * x - 0.1 * z, 5);
      expect(s.gx).toBeCloseTo(0.2, 6);
      expect(s.gz).toBeCloseTo(-0.1, 6);
    }
  });

  it('matches its gradient to a finite difference', () => {
    const f = make((x, z) => 40 + 10 * Math.sin(x / 30) * Math.cos(z / 45));
    const e = 1e-3;
    for (const [x, z] of [[5.3, 7.1], [-120.4, 60.9]]) {
      const s = f.sample(x, z);
      expect(s.gx).toBeCloseTo((f.heightAt(x + e, z) - f.heightAt(x - e, z)) / (2 * e), 4);
      expect(s.gz).toBeCloseTo((f.heightAt(x, z + e) - f.heightAt(x, z - e)) / (2 * e), 4);
    }
  });
});

describe('lineOfSight', () => {
  const hill = make((x) => 10 + 20 * Math.exp(-(x * x) / 400));
  it('is blocked by a hill between the points', () => {
    expect(lineOfSight(hill, { x: -80, y: 12, z: 0 }, { x: 80, y: 12, z: 0 })).toBe(false);
  });
  it('is clear over flat ground and from high above', () => {
    expect(lineOfSight(hill, { x: -120, y: 12, z: 40 }, { x: -60, y: 12, z: 40 })).toBe(true);
    expect(lineOfSight(hill, { x: -80, y: 80, z: 0 }, { x: 80, y: 12, z: 0 })).toBe(true);
  });
});

describe('findFeatures', () => {
  const g = (x: number, z: number, cx: number, cz: number, r: number, h: number) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
  it('finds hilltops, depressions and the saddle between two hills', () => {
    const f = make((x, z) => 30 + g(x, z, -25, 0, 18, 20) + g(x, z, 25, 0, 18, 20) + g(x, z, 0, 120, 16, -10));
    const feats = findFeatures(f);
    const near = (kind: string, x: number, z: number) => feats.some((q) => q.kind === kind && Math.hypot(q.x - x, q.z - z) < 4);
    expect(near("peak", -25, 0)).toBe(true);
    expect(near("peak", 25, 0)).toBe(true);
    expect(near('saddle', 0, 0)).toBe(true);
    expect(near('depression', 0, 120)).toBe(true);
    expect(feats.every((q) => Math.abs(q.x) < FIELD.half && Math.abs(q.z) < FIELD.half)).toBe(true);
  });
});
