import { describe, expect, it } from 'vitest';
import { LAYER } from '../src/config';
import { distToPath } from '../src/field/generate';
import { runBot } from '../src/sim/bot';
import { Dive } from '../src/sim/run';
import { buildSector, checkSector, difficulty } from '../src/sim/sector';

describe('sector generation', () => {
  it('builds a valid sector for seeds 1-50 and sectors 1-10, quickly', { timeout: 600000 }, () => {
    let worst = 0;
    let total = 0;
    let count = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      for (let index = 1; index <= 10; index++) {
        const t0 = performance.now();
        const s = buildSector(seed, index);
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms);
        total += ms;
        count++;
        const c = checkSector(s, difficulty(index));
        if (!c.ok) bad.push(`${seed}/${index}: ${c.reasons.join(', ')}`);
        // mines never sit on the hidden route
        for (const m of s.mines) expect(distToPath(s.path, m.x, m.z)[0]).toBeGreaterThan(12);
        // the sub starts under the layer, with water below it
        expect(s.entryY).toBeLessThan(s.layerY);
        expect(s.field.heightAt(s.entry[0], s.entry[1])).toBeLessThan(s.entryY - LAYER.clearance / 2);
      }
    }
    process.stdout.write(`sector generation: mean ${(total / count).toFixed(0)} ms, worst ${worst.toFixed(0)} ms\n`);
    expect(bad).toEqual([]);
    expect(total / count).toBeLessThan(300);
  });

  it('is deterministic', () => {
    const a = buildSector(42, 4);
    const b = buildSector(42, 4);
    expect(a.attempt).toBe(b.attempt);
    expect(Array.from(a.field.h.slice(0, 500))).toEqual(Array.from(b.field.h.slice(0, 500)));
    expect(a.contacts).toEqual(b.contacts);
  });

  it('adds watchers as the dive goes deeper', () => {
    const d = [1, 3, 5, 7, 9].map(difficulty);
    expect(d[0].ships + d[0].buoys + d[0].hunters).toBe(0);
    expect(d[1].ships).toBeGreaterThan(0);
    expect(d[2].buoys).toBeGreaterThan(0);
    expect(d[3].hunters).toBeGreaterThan(0);
    expect(d[3].mines).toBeGreaterThan(0);
    expect(d[4].layerY).toBeLessThan(d[0].layerY);
  });
});

describe('fairness', () => {
  it('a careful pilot on the hidden route clears sectors 1-6 without being crushed', { timeout: 600000 }, () => {
    for (const seed of [1, 2, 3, 4]) {
      const dive = new Dive(seed);
      while (dive.index <= 6) {
        const w = runBot(dive.world(), 900);
        expect(w.status, `seed ${seed} sector ${dive.index}`).toBe('cleared');
        dive.close(w);
        dive.choose(null);
      }
      expect(dive.totals.sectors).toBe(6);
      expect(dive.hull).toBeGreaterThan(0);
    }
  });
});
