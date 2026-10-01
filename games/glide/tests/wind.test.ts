import { describe, expect, it } from 'vitest';
import { RUN, WIND, WORLD } from '../src/config';
import { Gates } from '../src/world/gates';
import { Sectors, windName } from '../src/world/sectors';
import { TerrainField, seedVector } from '../src/world/terrainField';
import { ridgeLift } from '../src/world/wind';

/** A terrain stand-in: a plane rising to the east (+x) with the given slope. */
function ramp(slope: number): TerrainField {
  const f = new TerrainField(seedVector(1));
  (f as unknown as { heightAt: (x: number, z: number) => number }).heightAt = (x: number) => 100 + slope * x;
  return f;
}

describe('ridge lift', () => {
  it('lifts on the windward side and sinks on the lee', () => {
    const f = ramp(0.6);
    // wind blowing east, into the rising slope
    expect(ridgeLift(f, 10, 0, 0, 110, 0)).toBeGreaterThan(3);
    // wind blowing west, down the slope
    expect(ridgeLift(f, -10, 0, 0, 110, 0)).toBeLessThan(-2);
    // windward lift is stronger than the same lee sink
    expect(ridgeLift(f, 10, 0, 0, 110, 0)).toBeGreaterThan(-ridgeLift(f, -10, 0, 0, 110, 0));
  });

  it('is zero on flat ground and across the slope', () => {
    expect(ridgeLift(ramp(0), 10, 0, 0, 110, 0)).toBeCloseTo(0, 6);
    expect(ridgeLift(ramp(0.6), 0, 10, 0, 110, 0)).toBeCloseTo(0, 6);
  });

  it('fades with height above the ground', () => {
    const f = ramp(0.6);
    const near = ridgeLift(f, 10, 0, 0, 105, 0);
    const far = ridgeLift(f, 10, 0, 0, 100 + 2 * WIND.decay, 0);
    expect(far).toBeLessThan(near * 0.2);
    expect(far).toBeGreaterThan(0);
  });

  it('stops growing past the steepest slope', () => {
    expect(ridgeLift(ramp(5), 10, 0, 0, 100, 0)).toBeCloseTo(ridgeLift(ramp(WIND.maxSlope), 10, 0, 0, 100, 0), 6);
  });
});

describe('sectors', () => {
  const field = new TerrainField(seedVector(42));
  const sec = new Sectors(field, 42, 0);

  it('is the same for the same sheet', () => {
    expect(new Sectors(field, 42, 0).info(5)).toEqual(sec.info(5));
  });

  it('blows mostly across the valley, within the speed range', () => {
    for (let i = 1; i < 30; i++) {
      const s = sec.info(i);
      expect(Math.abs(s.dirX)).toBeGreaterThan(Math.cos(Math.PI / 2 - WIND.jitter) - 1e-9);
      expect(s.speed).toBeGreaterThanOrEqual(WIND.speedMin - 1e-9);
      expect(s.speed).toBeLessThanOrEqual(WIND.speedMax + 1e-9);
    }
    expect(sec.info(0).pattern).toBe('center');
  });

  it('turns the wind smoothly after a checkpoint', () => {
    const z = -RUN.sectorLength * 3;
    const a = sec.windAt(z + 1);
    const b = sec.windAt(z - 1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.2);
    const done = sec.windAt(z - WIND.blend - 1);
    const s3 = sec.info(3);
    expect(done.x).toBeCloseTo(s3.dirX * s3.speed, 6);
  });
});

describe('gate layouts', () => {
  it('never sinks a ring into the ground, in any layout', () => {
    for (const sheet of [1, 77, 427, 2048, 9999]) {
      const field = new TerrainField(seedVector(sheet));
      const gates = new Gates();
      gates.reset(field, sheet, 0, new Sectors(field, sheet, 0));
      const r = WORLD.gateRadius;
      for (let i = 0; i < 120; i++) {
        const g = gates.placement(i);
        const px = -g.nz;
        const pz = g.nx;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const s = Math.cos(a);
          const up = Math.sin(a);
          if (up > 0.01) continue;
          const ground = field.heightAt(g.x + px * r * s, g.z + pz * r * s);
          expect(g.y + up * r, `sheet ${sheet} gate ${i}`).toBeGreaterThan(ground - 1.5);
        }
      }
    }
  });
});

describe('wind names', () => {
  it('names the wind by where it comes from', () => {
    expect(windName(1, 0)).toBe('西風'); // blowing towards +x (east) comes from the west
    expect(windName(-1, 0)).toBe('東風');
    expect(windName(0, 1)).toBe('北風'); // towards +z (south)
    expect(windName(Math.SQRT1_2, -Math.SQRT1_2)).toBe('南西の風');
  });
});
