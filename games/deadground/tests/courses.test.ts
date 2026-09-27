import { describe, expect, it } from 'vitest';
import { WATCH } from '../src/config';
import { findFeatures } from '../src/field/features';
import { generate } from '../src/field/generate';
import { COURSES } from '../src/sim/courses';
import { validate } from '../src/sim/design';
import { autopilot } from '../src/sim/autopilot';

describe('courses', () => {
  it('has eight sheets with at most the supported number of watchers', () => {
    expect(COURSES.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const c of COURSES) expect(c.watchers.length).toBeLessThanOrEqual(WATCH.maxWatchers);
  });

  for (const course of COURSES) {
    describe(`${course.id} ${course.name}`, () => {
      const field = generate(course.terrain);

      it('puts every control on the feature its description names', () => {
        const feats = findFeatures(field);
        for (const c of course.controls) {
          expect(feats.some((f) => f.kind === c.kind && Math.hypot(f.x - c.x, f.z - c.z) < 3)).toBe(true);
        }
      });

      it('has a way through the dead ground', { timeout: 120000 }, () => {
        const v = validate(field, course);
        expect(v.reasons).toEqual([]);
      });

      it('can be run by an autopilot that reads the lights', { timeout: 300000 }, () => {
        const v = validate(field, course);
        const r = autopilot(course, field, v.routes.map((rt) => rt.points));
        process.stdout.write(`sheet ${course.id}: finished=${r.finished} time=${r.time.toFixed(0)}s par=${course.par}s caught=${r.caught}\n`);
        expect(r.finished).toBe(true);
        expect(r.caught).toBeLessThanOrEqual(2);
        // par is the autopilot's running time without penalties
        expect(r.time - r.caught * WATCH.caughtPenalty).toBeLessThanOrEqual(course.par * 1.05);
      });
    });
  }
});
