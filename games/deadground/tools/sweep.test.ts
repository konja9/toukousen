import { it } from 'vitest';
import { generate } from '../src/field/generate';
import { design, validate, type DesignSpec } from '../src/sim/design';

const specs: Array<Omit<DesignSpec, 'seed'> & { label: string }> = [
  { label: 's1', controls: 4, sweepTowers: 0, spinTowers: 0, patrols: 0 },
  { label: 's2', controls: 4, sweepTowers: 1, spinTowers: 0, patrols: 0 },
  { label: 's3', controls: 5, sweepTowers: 0, spinTowers: 1, patrols: 0 },
  { label: 's4', controls: 5, sweepTowers: 1, spinTowers: 1, patrols: 0 },
  { label: 's5', controls: 5, sweepTowers: 1, spinTowers: 0, patrols: 1 },
  { label: 's6', controls: 6, sweepTowers: 1, spinTowers: 1, patrols: 1 },
  { label: 's7', controls: 6, sweepTowers: 2, spinTowers: 0, patrols: 2 },
  { label: 's8', controls: 6, sweepTowers: 2, spinTowers: 1, patrols: 1 },
];

it('sweep', { timeout: 3_600_000 }, () => {
  const only = process.env.SPEC;
  for (const sp of specs) {
    if (only && sp.label !== only) continue;
    const rows: string[] = [];
    for (let seed = 1; seed <= Number(process.env.SEEDS ?? 24); seed++) {
      for (const variant of [0, 1]) {
        const d = design({ ...sp, seed, variant });
        if (!d) continue;
        const f = generate(d.terrain);
        const v = validate(f, d);
        if (v.ok) rows.push(`${sp.label} seed=${seed} v=${variant} len=${v.routeLength.toFixed(0)} run=${v.maxExposedRun.toFixed(0)} danger=${v.maxDanger.toFixed(1)} direct=${v.directExposure.toFixed(2)}`);
      }
    }
    process.stdout.write(rows.join('\n') + '\n');
  }
});
