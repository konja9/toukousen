import { describe, expect, it } from 'vitest';
import { PLAYER, WATCH } from '../src/config';
import { HeightField } from '../src/field/heightfield';
import { Player } from '../src/sim/player';
import { sees, watcherAt, type WatcherDef } from '../src/sim/watchers';

const make = (fn: (x: number, z: number) => number) => {
  const f = new HeightField();
  f.fill(fn);
  return f;
};
const flat = make(() => 20);

function walk(p: Player, f: HeightField, seconds: number, dx: number, dz: number, extra: Partial<{ sprint: boolean; crouch: boolean }> = {}) {
  for (let t = 0; t < seconds; t += 1 / 60) p.step(1 / 60, { dx, dz, sprint: false, crouch: false, ...extra }, f);
}

describe('Player', () => {
  it('jogs, sprints and crouches at their speeds on flat ground', () => {
    const p = new Player();
    p.place(0, 0, flat);
    walk(p, flat, 3, 0, -1);
    expect(p.speed).toBeCloseTo(PLAYER.jog, 1);
    walk(p, flat, 3, 0, -1, { sprint: true });
    expect(p.speed).toBeCloseTo(PLAYER.sprint, 1);
    walk(p, flat, 3, 0, -1, { crouch: true });
    expect(p.speed).toBeCloseTo(PLAYER.crouch, 1);
    expect(p.eyeY - p.y).toBeCloseTo(PLAYER.eyeCrouch, 5);
  });

  it('slows uphill and cannot climb a cliff, sliding along it instead', () => {
    const ramp = make((x) => 20 + Math.max(0, x) * 0.4);
    const p = new Player();
    p.place(10, 0, ramp);
    walk(p, ramp, 2, 1, 0);
    expect(p.speed).toBeLessThan(PLAYER.jog * 0.8);
    expect(p.speed).toBeGreaterThan(PLAYER.jog * 0.5);
    const cliff = make((x) => 20 + Math.max(0, x) * 2);
    const q = new Player();
    q.place(10, 0, cliff);
    walk(q, cliff, 2, 1, 0.2);
    expect(q.x).toBeLessThan(10.5);
    expect(Math.abs(q.z)).toBeGreaterThan(1);
  });

  it('stays on the sheet', () => {
    const p = new Player();
    p.place(230, 0, flat);
    walk(p, flat, 5, 1, 0);
    expect(p.x).toBeLessThanOrEqual(PLAYER.edge);
  });
});

describe('watchers', () => {
  it('a sweeping tower stays within its arc; a spinning one turns steadily', () => {
    const sweep: WatcherDef = { kind: 'tower', x: 0, z: 0, mode: 'sweep', from: -1, to: 1, period: 10 };
    for (let t = 0; t < 20; t += 0.37) {
      const h = watcherAt(sweep, t, flat).heading;
      expect(h).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(h).toBeLessThanOrEqual(1 + 1e-9);
    }
    const spin: WatcherDef = { kind: 'tower', x: 0, z: 0, mode: 'spin', speed: 0.5 };
    expect(watcherAt(spin, 2, flat).heading - watcherAt(spin, 0, flat).heading).toBeCloseTo(1, 6);
  });

  it('a patrol walks its loop and faces where it walks', () => {
    const patrol: WatcherDef = { kind: 'patrol', path: [[0, 0], [30, 0], [30, 30], [0, 30]] };
    const a = watcherAt(patrol, 5, flat);
    expect(a.eye.x).toBeCloseTo(5 * WATCH.patrolSpeed, 5);
    expect(a.heading).toBeCloseTo(Math.PI / 2, 5);
    const full = (120 / WATCH.patrolSpeed);
    const b = watcherAt(patrol, full + 5, flat);
    expect(b.eye.x).toBeCloseTo(a.eye.x, 5);
  });

  it('sees inside its cone and range only, and not through a hill', () => {
    const tower: WatcherDef = { kind: 'tower', x: 0, z: 0, mode: 'spin', speed: 0 };
    const s = watcherAt(tower, 0, flat); // looking north (-z)
    const eye = (x: number, z: number) => ({ x, y: 21.7, z });
    expect(sees(s, eye(0, -80), flat)).toBe(true);
    expect(sees(s, eye(0, 80), flat)).toBe(false);
    expect(sees(s, eye(80, -10), flat)).toBe(false);
    expect(sees(s, eye(0, -(WATCH.towerRange + 10)), flat)).toBe(false);
    const hill = make((x, z) => 20 + 25 * Math.exp(-(x * x + (z + 60) ** 2) / 200));
    expect(sees(watcherAt(tower, 0, hill), { x: 0, y: hill.heightAt(0, -110) + 1.7, z: -110 }, hill)).toBe(false);
  });
});
