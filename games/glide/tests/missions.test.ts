import { describe, expect, it } from 'vitest';
import { countMedals, MissionTracker, missionsFor, type RunStats } from '../src/game/missions';

const zero: RunStats = { distance: 0, skimBest: 0, bestChain: 0, ridgeGain: 0, maxSpeed: 0, sectors: 0, nearMisses: 0, score: 0 };

describe('missions', () => {
  it('gives every sheet the same three different challenges', () => {
    for (const sheet of [1, 2, 77, 427, 9999]) {
      const a = missionsFor(sheet);
      expect(a).toEqual(missionsFor(sheet));
      expect(a.length).toBe(3);
      expect(new Set(a.map((m) => m.kind)).size).toBe(3);
      for (const m of a) expect(m.label.length).toBeGreaterThan(3);
    }
    // not every sheet asks the same
    const kinds = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => missionsFor(s).map((m) => m.kind).join()));
    expect(kinds.size).toBeGreaterThan(3);
  });

  it('reports each completion once and remembers earlier ones', () => {
    const missions = missionsFor(77);
    const t = new MissionTracker(missions, 0);
    const big: RunStats = { distance: 1e6, skimBest: 1e6, bestChain: 99, ridgeGain: 1e6, maxSpeed: 1e3, sectors: 99, nearMisses: 99, score: 1e9 };
    expect(t.update(zero)).toEqual([]);
    expect(t.update(big)).toEqual([0, 1, 2]);
    expect(t.update(big)).toEqual([]);
    expect(t.done).toBe(7);
    // done in an earlier run: counted for this run, but not announced again
    const again = new MissionTracker(missions, 0b001);
    expect(again.update(big)).toEqual([1, 2]);
    expect(again.fresh).toBe(7);
    expect(t.progress(0, zero)).toBe(0);
    expect(t.progress(0, big)).toBe(1);
  });

  it('counts medals over all sheets', () => {
    expect(countMedals({ 1: 0b111, 2: 0b010, 3: 0 })).toBe(4);
  });
});
