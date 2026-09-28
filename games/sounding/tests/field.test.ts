import { describe, expect, it } from 'vitest';
import { ECHO } from '../src/config';
import { Echo, reach } from '../src/field/echo';
import { clearPath, crossesLayer, floorAt } from '../src/field/grid';
import { HeightField } from '../src/field/heightfield';
import { findRoute, floorGrid } from '../src/field/path';

const make = (fn: (x: number, z: number) => number) => {
  const f = new HeightField();
  f.fill(fn);
  return f;
};

describe('HeightField', () => {
  it('reproduces planes and their slope', () => {
    const f = make((x, z) => -120 + 0.2 * x - 0.1 * z);
    for (const [x, z] of [[0, 0], [13.7, -81.2], [-200.5, 150.25]]) {
      const s = f.sample(x, z);
      expect(s.h).toBeCloseTo(-120 + 0.2 * x - 0.1 * z, 4);
      expect(s.gx).toBeCloseTo(0.2, 5);
      expect(s.gz).toBeCloseTo(-0.1, 5);
    }
  });

  it('matches its gradient to a finite difference', () => {
    const f = make((x, z) => -150 + 30 * Math.sin(x / 40) * Math.cos(z / 55));
    const e = 1e-3;
    for (const [x, z] of [[5.3, 7.1], [-120.4, 60.9]]) {
      const s = f.sample(x, z);
      expect(s.gx).toBeCloseTo((f.heightAt(x + e, z) - f.heightAt(x - e, z)) / (2 * e), 3);
      expect(s.gz).toBeCloseTo((f.heightAt(x, z + e) - f.heightAt(x, z - e)) / (2 * e), 3);
    }
  });
});

// a flat floor at -200 with a ridge along x = 0 rising to -80
const ridge = make((x) => -200 + 120 * Math.exp(-(x * x) / 300));
const floor = floorGrid(ridge);

describe('echo grid', () => {
  it('interpolates the floor', () => {
    expect(floorAt(floor, -150, 20)).toBeCloseTo(-200, 1);
    expect(floorAt(floor, 0, 0)).toBeCloseTo(ridge.heightAt(0, 0), 0);
  });

  it('sees along open water but not through the ridge', () => {
    expect(clearPath(floor, { x: -150, y: -150, z: 0 }, { x: -60, y: -198, z: 40 })).toBe(true);
    expect(clearPath(floor, { x: -60, y: -150, z: 0 }, { x: 60, y: -150, z: 0 })).toBe(false);
    expect(clearPath(floor, { x: -60, y: -40, z: 0 }, { x: 60, y: -40, z: 0 })).toBe(true);
  });

  it('knows which side of the layer a point is on', () => {
    expect(crossesLayer(-50, -150, -100)).toBe(true);
    expect(crossesLayer(-110, -150, -100)).toBe(false);
  });
});

describe('Echo', () => {
  it('lights the floor the ping can see, at distance / speed, and never behind the ridge', () => {
    const echo = new Echo(floor);
    const ping = { kind: 'own' as const, x: -60, y: -150, z: 0, t0: 10, range: 160, speed: 150 };
    echo.ping(ping);
    for (let t = 10; t < 12; t += 0.05) echo.update(t);
    const idx = (x: number, z: number) => Math.round((z + 300) / ECHO.spacing) * ECHO.N + Math.round((x + 300) / ECHO.spacing);
    const near = idx(-100, 0);
    const d = Math.hypot(-100 + 60, floor[near] + 150, 0);
    expect(echo.own[near]).toBeCloseTo(10 + d / 150, 3);
    expect(echo.charted[near]).toBe(255);
    // far side of the ridge, within range: in shadow
    expect(echo.own[idx(60, 0)]).toBeLessThan(0);
    expect(echo.charted[idx(60, 0)]).toBe(0);
    // out of range
    expect(echo.own[idx(-280, 0)]).toBeLessThan(0);
    expect(echo.busy).toBe(false);
  });

  it('only lights the cone of a directional ping', () => {
    const echo = new Echo(floor);
    echo.ping({ kind: 'own', x: -150, y: -150, z: 0, t0: 0, range: 200, speed: 150, dir: [0, -1], cos: Math.cos(0.4) });
    for (let t = 0; t < 2; t += 0.05) echo.update(t);
    const idx = (x: number, z: number) => Math.round((z + 300) / ECHO.spacing) * ECHO.N + Math.round((x + 300) / ECHO.spacing);
    expect(echo.own[idx(-150, -100)]).toBeGreaterThan(0);
    expect(echo.own[idx(-150, 100)]).toBeLessThan(0);
  });

  it('reports when a ping reaches a point', () => {
    const ping = { kind: 'enemy' as const, x: -60, y: -150, z: 0, t0: 3, range: 200, speed: 150 };
    expect(reach(floor, ping, { x: -120, y: -150, z: 0 })).toBeCloseTo(3 + 60 / 150, 5);
    expect(reach(floor, ping, { x: 60, y: -150, z: 0 })).toBeNull();
    expect(reach(floor, ping, { x: -290, y: -150, z: 250 }, 1)).toBeNull();
  });
});

describe('findRoute', () => {
  it('prefers a long way under the layer to a short way over the ridge', () => {
    // the ridge has a deep gap at z > 100
    const gapped = make((x, z) => -200 + 120 * Math.exp(-(x * x) / 300) * (z > 100 ? 0 : 1));
    const r = findRoute(floorGrid(gapped), -110, [-100, 0], [100, 0]);
    expect(r.exposed).toBe(0);
    expect(r.points.some(([, z]) => z > 100)).toBe(true);
    // without the gap it has to cross, and says how far
    const r2 = findRoute(floor, -110, [-100, 0], [100, 0]);
    expect(r2.exposed).toBeGreaterThan(0);
    expect(r2.exposed).toBeLessThan(40);
  });
});
