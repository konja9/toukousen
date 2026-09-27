import { describe, expect, it } from 'vitest';
import { HeightField } from '../src/field/heightfield';
import { simulate } from '../src/sim/ball';
import { STAGES, type Stage } from '../src/sim/stages';
import { applyStroke, type Stroke } from '../src/sim/stroke';

function play(st: Stage, strokes: Stroke[]) {
  const f = new HeightField();
  f.fill(st.terrain, st.rock);
  f.soil = st.soil;
  for (const s of strokes) applyStroke(f, s);
  return simulate(f, st);
}

describe('stages', () => {
  it('has ten stages with unique ids', () => {
    expect(STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  for (const st of STAGES) {
    describe(`${st.id} ${st.name}`, () => {
      it('cannot be cleared without editing', () => {
        expect(play(st, []).state).not.toBe('holed');
      });

      it('is cleared by its reference solution within par', () => {
        expect(st.solution.length).toBeLessThanOrEqual(st.par);
        expect(play(st, st.solution).state).toBe('holed');
      });

      it('tolerates imprecise strokes', () => {
        // jitter positions by up to 1.5 m and durations by 20% with a fixed seed
        let seed = 7 + st.id;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
        let ok = 0;
        for (let k = 0; k < 16; k++) {
          const jit = st.solution.map((s) => ({
            ...s,
            seconds: s.seconds * (1 + 0.2 * rnd()),
            points: s.points.map(([x, z]) => [x + 1.5 * rnd(), z + 1.5 * rnd()] as [number, number]),
          }));
          if (play(st, jit).state === 'holed') ok++;
        }
        expect(ok).toBeGreaterThanOrEqual(4);
      });

      it('keeps start, goal and benchmarks on the model and out of the water', () => {
        const f = new HeightField();
        f.fill(st.terrain, st.rock);
        for (const [x, z] of [st.start, st.goal, ...st.checkpoints]) {
          expect(Math.abs(x)).toBeLessThan(38);
          expect(Math.abs(z)).toBeLessThan(38);
          if (st.water !== null) expect(f.heightAt(x, z)).toBeGreaterThan(st.water);
        }
      });
    });
  }
});
