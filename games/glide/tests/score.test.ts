import { describe, expect, it } from 'vitest';
import { ScoreKeeper, lowMultiplier } from '../src/game/score';

describe('lowMultiplier', () => {
  it('rewards flying close to the ground', () => {
    expect(lowMultiplier(3)).toBe(4);
    expect(lowMultiplier(12)).toBe(3);
    expect(lowMultiplier(25)).toBe(2);
    expect(lowMultiplier(80)).toBe(1);
  });
});

describe('ScoreKeeper', () => {
  it('scores only new forward progress, scaled by the multiplier', () => {
    const s = new ScoreKeeper();
    s.update(0.1, 100, 80, 50); // x1
    s.update(0.1, 150, 5, 50); // +50 x4
    s.update(0.1, 120, 5, 50); // going backwards scores nothing
    expect(s.score).toBe(100 + 200);
    expect(s.distance).toBe(150);
    expect(s.minAGL).toBe(5);
  });

  it('chains gate bonuses and resets on a miss', () => {
    const s = new ScoreKeeper();
    expect(s.gate(true)).toBe(200);
    expect(s.gate(true)).toBe(400);
    expect(s.gate(false)).toBe(0);
    expect(s.chain).toBe(0);
    expect(s.gate(true)).toBe(200);
    expect(s.bestChain).toBe(2);
    expect(s.gatesPassed).toBe(3);
    expect(s.gatesTotal).toBe(4);
    expect(s.score).toBe(800);
  });
});
