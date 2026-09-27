import { describe, expect, it } from 'vitest';
import { HeightField } from '../src/field/heightfield';
import { simulate, type Course } from '../src/sim/ball';

const course = (over: Partial<Course> = {}): Course => ({ start: [-20, 0], goal: [30, 0], checkpoints: [], water: null, ...over });

/** Gentle slope toward +x, a bowl at x = 24 and a wall behind it. */
const cupSlope = (x: number) => 12 - 0.06 * Math.min(x + 20, 40) - 1.5 * Math.exp(-((x - 24) ** 2) / 18) + Math.max(0, x - 28) * 0.6;

function field(fn: (x: number, z: number) => number) {
  const f = new HeightField();
  f.fill(fn);
  return f;
}

describe('Ball', () => {
  it('rests on flat ground', () => {
    expect(simulate(field(() => 5), course()).state).toBe('stuck');
  });

  it('rolls downhill and falls off the model edge', () => {
    const r = simulate(field((x) => 20 - 0.15 * x), course({ goal: [0, 30] }));
    expect(r.state).toBe('out');
    expect(r.path[r.path.length - 1][0]).toBeGreaterThan(30);
  });

  it('drops into the cup at the end of a slope', () => {
    // slope toward +x that flattens into a bowl around the goal
    const f = field(cupSlope);
    expect(simulate(f, course({ goal: [24, 0] })).state).toBe('holed');
  });

  it('sinks in water', () => {
    const f = field((x) => 10 - 0.2 * (x + 20));
    expect(simulate(f, course({ water: 4 })).state).toBe('sunk');
  });

  it('requires every benchmark before the cup counts', () => {
    const f = field(cupSlope);
    const r = simulate(f, course({ goal: [24, 0], checkpoints: [[0, 15]] }));
    expect(r.state).toBe('unsurveyed');
  });

  it('is deterministic', () => {
    const f = field((x, z) => 10 - 0.1 * x + Math.sin(z * 0.3));
    const a = simulate(f, course());
    const b = simulate(f, course());
    expect(a.path).toEqual(b.path);
  });
});
