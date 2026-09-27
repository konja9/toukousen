import { describe, expect, it } from 'vitest';
import { FLIGHT } from '../src/config';
import { Glider } from '../src/player/glider';

const H = 1 / 120;
const idle = { pitch: 0, roll: 0, brake: false };

function run(g: Glider, seconds: number, input = idle, lift = 0) {
  for (let t = 0; t < seconds; t += H) g.step(H, input, lift);
}

function fresh(): Glider {
  const g = new Glider();
  g.reset(0, 500, 0, 0);
  return g;
}

describe('Glider', () => {
  it('trades height for speed when diving and speed for height when climbing', () => {
    const dive = fresh();
    run(dive, 1.5, { pitch: -1, roll: 0, brake: false });
    expect(dive.speed).toBeGreaterThan(FLIGHT.startSpeed);
    expect(dive.y).toBeLessThan(500);

    const climb = fresh();
    run(climb, 1.5, { pitch: 1, roll: 0, brake: false });
    expect(climb.speed).toBeLessThan(FLIGHT.startSpeed);
    expect(climb.y).toBeGreaterThan(500);
  });

  it('never gains energy without lift', () => {
    const g = fresh();
    const inputs = [
      { pitch: -1, roll: 0.5, brake: false },
      { pitch: 1, roll: -1, brake: false },
      { pitch: 0, roll: 0, brake: true },
      idle,
    ];
    let e = g.energy();
    for (let i = 0; i < 4000; i++) {
      g.step(H, inputs[Math.floor(i / 250) % inputs.length], 0);
      const next = g.energy();
      // tiny tolerance for the speed clamp at the limits
      expect(next).toBeLessThanOrEqual(e + 1e-6);
      e = next;
    }
  });

  it('climbs inside a thermal', () => {
    const g = fresh();
    run(g, 3, idle, 12);
    expect(g.y).toBeGreaterThan(520);
  });

  it('stalls when too slow and drops the nose', () => {
    const g = fresh();
    run(g, 8, { pitch: 1, roll: 0, brake: false });
    expect(g.stalled).toBe(true);
    run(g, 1, { pitch: 1, roll: 0, brake: false });
    expect(g.pitch).toBeLessThan(0);
  });

  it('turns toward the bank and respects the yaw limit', () => {
    const g = fresh();
    run(g, 2, { pitch: 0, roll: 1, brake: false });
    expect(g.yaw).toBeGreaterThan(0.2);
    run(g, 30, { pitch: 0.2, roll: 1, brake: false });
    expect(g.yaw).toBeLessThanOrEqual(FLIGHT.yawLimit + 1e-9);
  });
});
