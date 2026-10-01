import { describe, expect, it } from 'vitest';
import { RUN } from '../src/config';
import { NearMiss, RunClock } from '../src/game/run';

describe('RunClock', () => {
  it('adds time at each checkpoint and records the sector times', () => {
    const c = new RunClock();
    const ev = [];
    let progress = 0;
    for (let i = 0; i < 300; i++) {
      progress += 0.1 * 100; // 100 m/s in 0.1 s steps
      ev.push(...c.update(0.1, progress, () => 0));
    }
    const cps = ev.filter((e) => e.type === 'checkpoint');
    expect(cps.length).toBe(Math.floor(progress / RUN.sectorLength));
    expect(cps.length).toBeGreaterThan(0);
    expect(c.splits[0]).toBeCloseTo(RUN.sectorLength / 100, 0);
    expect(c.remaining).toBeCloseTo(RUN.startTime - 30 + cps.length * RUN.bonus0, 3);
    expect(c.timeUp).toBe(false);
  });

  it('gives less time as the course gets harder', () => {
    expect(RunClock.bonus(1)).toBe(RUN.bonus1);
    expect(RunClock.bonus(0.5)).toBeLessThan(RunClock.bonus(0));
  });

  it('ticks in the last seconds and ends at zero', () => {
    const c = new RunClock();
    const ev = [];
    for (let t = 0; t < RUN.startTime + 1; t += 0.05) ev.push(...c.update(0.05, 0, () => 0));
    const ticks = ev.filter((e) => e.type === 'tick');
    expect(ticks.length).toBe(RUN.warnTime);
    expect(ev.filter((e) => e.type === 'timeup').length).toBe(1);
    expect(c.timeUp).toBe(true);
    expect(c.update(0.05, 9999, () => 0)).toEqual([]);
  });
});

describe('NearMiss', () => {
  const wall = (x: number) => (x > 5 ? 200 : 0); // a cliff 5 m to the right (+x) of x = 0
  it('fires beside a wall at our height, once per pass', () => {
    const n = new NearMiss();
    const body = { x: 0, y: 50, z: 0, yaw: 0, speed: 60 };
    expect(n.update(0.01, body, wall)).toBe(1);
    expect(n.update(0.01, body, wall)).toBe(0);
    for (let i = 0; i < 200; i++) n.update(0.01, body, wall);
    expect(n.count).toBeGreaterThan(1);
  });

  it('stays quiet over open ground, far from walls, or when slow', () => {
    const n = new NearMiss();
    expect(n.update(0.01, { x: 0, y: 50, z: 0, yaw: 0, speed: 60 }, () => 0)).toBe(0);
    expect(n.update(0.01, { x: -20, y: 50, z: 0, yaw: 0, speed: 60 }, wall)).toBe(0);
    expect(n.update(0.01, { x: 0, y: 50, z: 0, yaw: 0, speed: 20 }, wall)).toBe(0);
  });
});
