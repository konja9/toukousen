import { describe, expect, it } from 'vitest';
import { FIELD } from '../src/config';
import { HeightField } from '../src/field/heightfield';

const make = (fn: (x: number, z: number) => number = () => 5) => {
  const f = new HeightField();
  f.fill(fn);
  return f;
};

describe('HeightField', () => {
  it('reproduces planes exactly (B-splines preserve linear functions)', () => {
    const f = make((x, z) => 10 + 0.1 * x - 0.05 * z);
    for (const [x, z] of [[0, 0], [3.3, -7.7], [-20.5, 12.25]]) {
      const s = f.sample(x, z);
      expect(s.h).toBeCloseTo(10 + 0.1 * x - 0.05 * z, 6);
      expect(s.gx).toBeCloseTo(0.1, 6);
      expect(s.gz).toBeCloseTo(-0.05, 6);
    }
  });

  it('is continuous across grid cells', () => {
    const f = make((x, z) => 5 + Math.sin(x * 0.7) * 2 + Math.cos(z * 0.9));
    for (const x of [-10, 0, 7, 21]) {
      const a = f.heightAt(x - 1e-6, 3.5);
      const b = f.heightAt(x + 1e-6, 3.5);
      expect(Math.abs(a - b)).toBeLessThan(1e-4);
    }
  });

  it('matches its gradient to a finite difference', () => {
    const f = make((x, z) => 5 + Math.sin(x * 0.3) * 3 + z * z * 0.01);
    const e = 1e-4;
    for (const [x, z] of [[1.3, 2.7], [-12.1, 8.4]]) {
      const s = f.sample(x, z);
      expect(s.gx).toBeCloseTo((f.heightAt(x + e, z) - f.heightAt(x - e, z)) / (2 * e), 4);
      expect(s.gz).toBeCloseTo((f.heightAt(x, z + e) - f.heightAt(x, z - e)) / (2 * e), 4);
    }
  });

  it('balances cut and fill: soil moves, volume is conserved', () => {
    const f = make(() => 8);
    const v0 = f.volume();
    const cut = f.brush(-10, 0, 6, 1.5, 'cut');
    expect(cut).toBeGreaterThan(0);
    expect(f.soil).toBeCloseTo(cut, 6);
    const filled = f.brush(10, 0, 6, 1.5, 'raise');
    expect(filled).toBeCloseTo(cut, 3);
    expect(f.volume() + f.soil).toBeCloseTo(v0, 2);
  });

  it('cannot raise without soil', () => {
    const f = make(() => 8);
    expect(f.brush(0, 0, 6, 1, 'raise')).toBe(0);
    expect(f.heightAt(0, 0)).toBeCloseTo(8, 6);
  });

  it('never edits bedrock and clamps to the model limits', () => {
    const f = new HeightField();
    f.fill(() => 1, (x) => (x < 0 ? 1 : 0));
    f.soil = 1e6;
    const before = f.heightAt(-20, 0);
    f.brush(-20, 0, 6, 5, 'cut');
    expect(f.heightAt(-20, 0)).toBeCloseTo(before, 6);
    for (let i = 0; i < 20; i++) f.brush(20, 0, 6, 5, 'cut');
    expect(Math.min(...f.h)).toBeGreaterThanOrEqual(FIELD.minH);
    for (let i = 0; i < 40; i++) f.brush(20, 0, 6, 5, 'raise');
    expect(Math.max(...f.h)).toBeLessThanOrEqual(FIELD.maxH);
  });

  it('undoes strokes including the soil balance', () => {
    const f = make(() => 8);
    f.pushUndo();
    f.brush(0, 0, 5, 2, 'cut');
    const soil = f.soil;
    expect(soil).toBeGreaterThan(0);
    expect(f.undo()).toBe(true);
    expect(f.soil).toBe(0);
    expect(f.heightAt(0, 0)).toBeCloseTo(8, 6);
    expect(f.undo()).toBe(false);
  });
});
