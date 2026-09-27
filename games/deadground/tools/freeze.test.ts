import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { generate } from '../src/field/generate';
import { design, validate, type DesignSpec } from '../src/sim/design';
import { autopilot } from '../src/sim/autopilot';
import type { Course } from '../src/sim/course';

/**
 * Authoring tool (run manually): turns the chosen generator settings into the
 * literal data in src/sim/courses.ts, so shipped sheets never change when the
 * generator is tweaked.  npm run freeze  (reads tools/picks.json)
 */
interface Pick extends DesignSpec {
  name: string;
  nameJa: string;
  brief: string;
  /** Other [seed, variant] pairs to try if this one fails. */
  alts?: Array<[number, number]>;
}

const picks: Pick[] = JSON.parse(readFileSync(new URL('./picks.json', import.meta.url), 'utf8'));

it('freeze', { timeout: 600000 }, () => {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: string[] = [];
  const usedSeeds = new Set<number>();
  picks.forEach((pick, i) => {
    const tries: Array<[number, number]> = [[pick.seed, pick.variant ?? 0], ...(pick.alts ?? [])];
    let chosen: { p: Pick; d: NonNullable<ReturnType<typeof design>> } | null = null;
    let lastErr = '';
    for (const [seed, variant] of tries) {
      if (usedSeeds.has(seed)) continue;
      const p = { ...pick, seed, variant };
      const d = design(p);
      if (!d) continue;
      const res = tryFreeze(p, d, i);
      if (typeof res === 'string') {
        lastErr = res;
        process.stdout.write(`pick ${i + 1} seed ${seed} v${variant} rejected: ${res}\n`);
        continue;
      }
      chosen = { p, d };
      usedSeeds.add(seed);
      out.push(res.src);
      process.stdout.write(res.log);
      break;
    }
    if (!chosen) throw new Error(`pick ${i + 1}: no candidate passed (${lastErr})`);
  });
  function tryFreeze(p: Pick, d: NonNullable<ReturnType<typeof design>>, i: number): string | { src: string; log: string } {
    const watchers = d.watchers.map((w) =>
      w.kind === 'tower'
        ? w.mode === 'spin'
          ? { kind: 'tower' as const, x: r2(w.x), z: r2(w.z), mode: 'spin' as const, speed: r2(w.speed), phase: r2(w.phase ?? 0) }
          : { kind: 'tower' as const, x: r2(w.x), z: r2(w.z), mode: 'sweep' as const, from: r2(w.from), to: r2(w.to), period: r2(w.period), phase: r2(w.phase ?? 0) }
        : { kind: 'patrol' as const, path: w.path.map(([x, z]) => [r2(x), r2(z)] as [number, number]), phase: r2(w.phase ?? 0) },
    );
    const course: Course = {
      id: i + 1,
      name: p.name,
      nameJa: p.nameJa,
      brief: p.brief,
      terrain: d.terrain,
      start: [r2(d.start[0]), r2(d.start[1])],
      controls: d.controls.map((c) => ({ x: r2(c.x), z: r2(c.z), kind: c.kind })),
      finish: [r2(d.finish[0]), r2(d.finish[1])],
      watchers,
      par: 0,
    };
    const field = generate(d.terrain);
    const v = validate(field, course);
    if (!v.ok) return `invalid after rounding: ${v.reasons.join('; ')}`;
    const run = autopilot(course, field, v.routes.map((r) => r.points));
    if (!run.finished) return 'autopilot did not finish';
    if (run.caught > 2) return `autopilot caught ${run.caught} times`;
    // par: the autopilot's time without penalties, rounded up to 10 s
    const par = Math.ceil((run.time - run.caught * 30) / 10) * 10;
    const src = `  {
    id: ${i + 1},
    name: ${JSON.stringify(p.name)},
    nameJa: ${JSON.stringify(p.nameJa)},
    brief: ${JSON.stringify(p.brief)},
    terrain: ${JSON.stringify(d.terrain)},
    start: [${r2(d.start[0])}, ${r2(d.start[1])}],
    controls: ${JSON.stringify(d.controls.map((c) => ({ x: r2(c.x), z: r2(c.z), kind: c.kind })))},
    finish: [${r2(d.finish[0])}, ${r2(d.finish[1])}],
    watchers: ${JSON.stringify(watchers)},
    par: ${par},
  },`;
    const log = `pick ${i + 1}: seed ${p.seed} v${p.variant} route ${v.routeLength.toFixed(0)} m, par ${par} s, autopilot caught ${run.caught}, danger ${v.maxDanger.toFixed(1)}, direct ${v.directExposure.toFixed(2)}\n`;
    return { src, log };
  }
  const src = `import type { Course } from './course';

/**
 * The eight sheets. Generated once by tools/freeze.test.ts from the course
 * designer (src/sim/design.ts) and frozen here as data; tests/courses.test.ts
 * re-validates every sheet.
 */
export const COURSES: Course[] = [
${out.join('\n')}
];
`;
  writeFileSync('src/sim/courses.ts', src);
});
