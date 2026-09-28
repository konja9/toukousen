import { describe, expect, it } from 'vitest';
import { snoise } from '../src/world/noise';
import { TerrainField, seedVector } from '../src/world/terrainField';

describe('snoise', () => {
  it('stays within [-1, 1] and is not constant', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = snoise(i * 0.137 - 500, i * 0.071 + 300);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1.2);
  });
});

describe('TerrainField', () => {
  it('is deterministic per sheet and differs between sheets', () => {
    const a = new TerrainField(seedVector(427));
    const b = new TerrainField(seedVector(427));
    const c = new TerrainField(seedVector(428));
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      const x = i * 37 - 900;
      const z = -i * 211;
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
      diff += Math.abs(a.heightAt(x, z) - c.heightAt(x, z));
    }
    expect(diff / 50).toBeGreaterThan(5);
  });

  it('seed vectors are float32-exact (they are uploaded as uniforms)', () => {
    for (const s of [1, 427, 9999]) {
      const [x, y] = seedVector(s);
      expect(Math.fround(x)).toBe(x);
      expect(Math.fround(y)).toBe(y);
    }
  });

  it('carves a valley that is lower than its surroundings', () => {
    for (const sheet of [1, 427, 9999]) {
      const f = new TerrainField(seedVector(sheet));
      let inside = 0;
      let outside = 0;
      for (let z = 0; z > -20000; z -= 250) {
        const cx = f.valleyCenter(z);
        inside += f.heightAt(cx, z);
        outside += Math.max(f.heightAt(cx - 450, z), f.heightAt(cx + 450, z));
      }
      expect(outside - inside).toBeGreaterThan(0);
      expect(inside / 80).toBeLessThan(60);
    }
  });

  it('ramps difficulty with forward distance only', () => {
    const f = new TerrainField(seedVector(1));
    expect(f.difficulty(1000)).toBe(0);
    expect(f.difficulty(0)).toBe(0);
    expect(f.difficulty(-12000)).toBeCloseTo(0.5, 5);
    expect(f.difficulty(-50000)).toBe(1);
  });
});
