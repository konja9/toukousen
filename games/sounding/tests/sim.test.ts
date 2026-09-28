import { describe, expect, it } from 'vitest';
import { CONTACT, LAYER, SUB } from '../src/config';
import { HeightField } from '../src/field/heightfield';
import { floorGrid } from '../src/field/path';
import { Contact, hearingRange } from '../src/sim/contacts';
import type { Sector } from '../src/sim/sector';
import { Sub } from '../src/sim/sub';
import { applyAll, offer, UPGRADES } from '../src/sim/upgrades';
import { World } from '../src/sim/world';

const make = (fn: (x: number, z: number) => number) => {
  const f = new HeightField();
  f.fill(fn);
  return f;
};
const mods = applyAll([]);
const flat = make(() => -300);

describe('Sub', () => {
  it('runs at the speed of each throttle step and drains the battery faster when fast', () => {
    const s = new Sub();
    s.place(0, -100, 0, 0);
    s.setLevel(2);
    for (let i = 0; i < 400; i++) s.step(0.05, { turn: 0, climb: 0 }, flat, mods);
    expect(s.speed).toBeCloseTo(SUB.speeds[2], 1);
    expect(s.z).toBeLessThan(-50);
    const b = s.battery;
    s.setLevel(3);
    for (let i = 0; i < 200; i++) s.step(0.05, { turn: 0, climb: 0 }, flat, mods);
    expect(b - s.battery).toBeGreaterThan(SUB.drain[3] * 9);
    expect(s.noise(mods)).toBe(SUB.noise[3]);
  });

  it('cannot come shallower than the minimum depth', () => {
    const s = new Sub();
    s.place(0, -20, 0, 0);
    for (let i = 0; i < 200; i++) s.step(0.05, { turn: 0, climb: 1 }, flat, mods);
    expect(s.y).toBeLessThanOrEqual(-SUB.minDepth);
  });

  it('stops at a wall and takes damage for a fast hit, rides up a gentle slope', () => {
    const wall = make((_x, z) => (z < -40 ? -20 : -300));
    const s = new Sub();
    s.place(0, -150, 0, 0);
    s.setLevel(3);
    let hit = 0;
    for (let i = 0; i < 400; i++) hit = Math.max(hit, s.step(0.05, { turn: 0, climb: 0 }, wall, mods).impact);
    expect(s.z).toBeGreaterThan(-42);
    expect(hit).toBeGreaterThan(3);
    expect(s.hull).toBeLessThan(SUB.hull);
    const ramp = make((_x, z) => -200 - z * 0.15);
    const r = new Sub();
    r.place(0, -196, 0, 0);
    r.setLevel(1);
    for (let i = 0; i < 400; i++) r.step(0.05, { turn: 0, climb: 0 }, ramp, mods);
    expect(r.hull).toBe(SUB.hull);
    expect(r.y).toBeGreaterThan(-196);
  });

  it('is limited to the slow step with an empty battery', () => {
    const s = new Sub();
    s.place(0, -100, 0, 0);
    s.battery = 0;
    s.setLevel(3);
    for (let i = 0; i < 300; i++) s.step(0.05, { turn: 0, climb: 0 }, flat, mods);
    expect(s.speed).toBeCloseTo(SUB.speeds[1], 1);
  });
});

describe('hearing', () => {
  it('halves across the thermocline', () => {
    expect(hearingRange(100, 1, -50, -80, -100)).toBe(100);
    expect(hearingRange(100, 1, -50, -150, -100)).toBe(100 * LAYER.attenuation);
  });
});

/** A small test sector: flat floor at -300 (or a given field), a layer at -100, one ship circling. */
function sector(field: HeightField, contacts: Sector['contacts'] = []): Sector {
  const floor = floorGrid(field);
  return {
    seed: 1, index: 5, attempt: 0, layerY: -100, field, floor,
    entry: [0, 250], entryY: -150, entryHeading: 0,
    exit: [0, -250], exitY: -290, exitHint: { x: 0, z: -250, r: 80 },
    route: { points: [], length: 0, exposed: 0, maxExposedRun: 0 }, path: [[0, 250], [0, -250]],
    contacts, mines: [], surveys: [], carves: [],
  };
}
const ship = (x: number, z: number): Sector['contacts'][number] => ({ kind: 'ship', path: [[x - 20, z], [x + 20, z], [x, z + 20]], y: -4, phase: 0 });
const idle = { level: 0, turn: 0, climb: 0 };

describe('World', () => {
  it('a ping above the layer is heard, the ship searches, pings and finds the sub', () => {
    const w = new World(sector(flat, [ship(0, 150)]), mods, { hull: 100, battery: 100, decoys: 0 });
    w.sub.place(0, -60, 200, 0);
    const events: string[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      for (const e of w.step(0.05, { ...idle, ping: i === 0 ? 'omni' : null })) events.push(e.type);
      if (w.contacts[0].mode === 'hunt') break;
    }
    expect(events).toContain('heard');
    expect(events).toContain('detected');
    expect(w.contacts[0].mode).toBe('hunt');
    expect(w.stats.detections).toBe(1);
  });

  it('a slow sub deep under the layer is not heard by a ship right above it', () => {
    const w = new World(sector(flat, [ship(0, 200)]), mods, { hull: 100, battery: 100, decoys: 0 });
    w.sub.place(0, -150, 200, 0);
    for (let i = 0; i < 20 * 30; i++) w.step(0.05, { ...idle, level: 1 });
    expect(w.contacts[0].mode).toBe('patrol');
  });

  it('a ridge between the ship and the sub hides the sub from its pings', () => {
    // a wall at z in [120, 160] rising to -30; the sub sits deep behind it
    const walled = make((_x, z) => (z > 120 && z < 160 ? -30 : -300));
    const w = new World(sector(walled, [ship(0, 60)]), mods, { hull: 100, battery: 100, decoys: 0 });
    w.sub.place(0, -250, 200, 0);
    const k = w.contacts[0];
    k.alert(0, { x: 0, y: -250, z: 90 });
    let detected = false;
    for (let i = 0; i < 20 * 20; i++) for (const e of w.step(0.05, idle)) if (e.type === 'detected') detected = true;
    expect(detected).toBe(false);
  });

  it('gives up after a while without contact and returns to its patrol', () => {
    const w = new World(sector(flat, [ship(0, 0)]), mods, { hull: 100, battery: 100, decoys: 0 });
    w.sub.place(200, -250, 200, 0);
    const k = w.contacts[0];
    k.alert(0, { x: -150, y: -60, z: -150 });
    const seen = new Set<string>();
    for (let i = 0; i < 20 * (CONTACT.giveUp + 90); i++) {
      w.step(0.05, idle);
      seen.add(k.mode);
    }
    expect(seen.has('search')).toBe(true);
    expect(seen.has('return')).toBe(true);
    expect(k.mode).toBe('patrol');
  });

  it('depth charges hurt more the closer they go off', () => {
    const hit = (dx: number) => {
      const w = new World(sector(flat, [ship(0, 0)]), mods, { hull: 100, battery: 100, decoys: 0 });
      w.sub.place(dx, -120, 0, 0);
      const k = w.contacts[0];
      k.detect(0, { x: 0, y: -120, z: 0 });
      k.x = 0;
      k.z = 0;
      for (let i = 0; i < 20 * 15; i++) w.step(0.05, idle);
      return 100 - w.sub.hull;
    };
    const close = hit(3);
    const far = hit(60);
    expect(close).toBeGreaterThan(20);
    expect(far).toBe(0);
  });

  it('clears when the sub dives into the exit trench', () => {
    const w = new World(sector(flat), mods, { hull: 100, battery: 100, decoys: 0 });
    w.sub.place(0, -200, -250, 0);
    const ev = w.step(0.05, idle);
    expect(ev.some((e) => e.type === 'cleared')).toBe(true);
    expect(w.status).toBe('cleared');
  });
});

describe('upgrades', () => {
  it('offers three different refits and never a one-off twice', () => {
    for (let i = 1; i < 30; i++) {
      const o = offer(7, i, ['cone', 'passive']);
      expect(new Set(o).size).toBe(3);
      expect(o).not.toContain('cone');
      expect(o).not.toContain('passive');
    }
    expect(UPGRADES.length).toBe(8);
    const m = applyAll(['quiet', 'quiet', 'sonar']);
    expect(m.noiseMul).toBeCloseTo(0.49, 5);
    expect(m.pingRangeMul).toBeCloseTo(1.3, 5);
  });
});

it('contacts start on their patrol path', () => {
  const c = new Contact(ship(50, 50), 0, floorGrid(flat));
  expect(Math.hypot(c.x - 50, c.z - 50)).toBeLessThan(30);
  expect(c.y).toBe(-4);
});
