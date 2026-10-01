import { describe, expect, it } from 'vitest';
import { FLIGHT, TERRAIN } from '../src/config';
import { Glider } from '../src/player/glider';
import { Gates } from '../src/world/gates';
import { Sectors } from '../src/world/sectors';
import { TerrainField, seedVector } from '../src/world/terrainField';
import { Thermals } from '../src/world/thermals';
import { ScoreKeeper } from '../src/game/score';
import { NearMiss, RunClock } from '../src/game/run';
import { Wind } from '../src/world/wind';

/** Offset from the valley center of the line through the gates at z (bias where there are none). */
function lineOffset(field: TerrainField, list: Gates['list'], z: number, bias: number): number {
  const off = (q: Gates['list'][number]) => q.x - field.valleyCenter(q.z);
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (z <= a.z && z >= b.z) return off(a) + (off(b) - off(a)) * ((a.z - z) / (a.z - b.z));
  }
  return list.length && z < list[list.length - 1].z ? off(list[list.length - 1]) : bias;
}

/**
 * Playability check: a simple autopilot that flies the line through the gates
 * along the valley must keep ahead of the clock for several sectors on every
 * sheet. Guards against tuning changes that make the course or the time limit
 * impossible. With `cruise` set it ignores the gates and holds that height
 * above the terrain instead (the safe, slow way to fly).
 */
function fly(sheet: number, seconds: number, cruise = 0) {
  const field = new TerrainField(seedVector(sheet));
  const thermals = new Thermals();
  const gates = new Gates();
  thermals.reset(field, sheet, 0);
  const sectors = new Sectors(field, sheet, 0);
  gates.reset(field, sheet, 0, sectors);
  const wind = new Wind(field, sectors);
  const clock = new RunClock();
  const near = new NearMiss();
  const g = new Glider();
  const x0 = field.valleyCenter(0);
  g.reset(x0, field.heightAt(x0, 0) + FLIGHT.startAGL, 0, field.valleyHeading(0));
  const score = new ScoreKeeper();
  const h = 1 / FLIGHT.stepHz;
  const heightAt = (x: number, z: number) => field.heightAt(x, z);
  let t = 0;
  let cause = 'time';
  let ridgeGain = 0;
  let margin = Infinity;
  for (; t < seconds; t += h) {
    thermals.update(g.z);
    gates.update(g.z, h, t);
    const next = gates.list.find((q) => q.state === 'pending');
    // Follow a line through the gate centers, measured from the valley center
    // (the valley bends), with a pursuit point a little ahead.
    const gateNear = next && next.z < g.z && next.z > g.z - 420;
    const tz = g.z - 130;
    const w = wind.at(tz);
    const halfW = TERRAIN.halfWidth0 + (TERRAIN.halfWidth1 - TERRAIN.halfWidth0) * field.difficulty(tz);
    const tx = field.valleyCenter(tz) + lineOffset(field, gates.list, tz, Math.sign(w.x) * halfW * 0.2);
    const want = Math.atan2(tx - g.x, g.z - tz);
    const bankWant = Math.max(-1, Math.min(1, (want - g.yaw) * 2.2));
    const roll = Math.max(-1, Math.min(1, (bankWant * 1.05 - g.bank) * 3 + bankWant));
    // hold a target height: gate height, or clear the terrain ahead
    let ahead = 0;
    for (const d of [0, 40, 80, 140]) ahead = Math.max(ahead, field.heightAt(g.x + g.vx * (d / g.speed), g.z + g.vz * (d / g.speed)));
    const targetY = cruise ? ahead + cruise : gateNear ? Math.max(next.y, ahead + 8) : ahead + 22;
    const pitchWant = Math.max(-0.35, Math.min(0.3, (targetY - g.y) * 0.02));
    const pitch = Math.max(-1, Math.min(1, (pitchWant - g.pitch) * 4));
    const ax = g.x, ay = g.y, az = g.z;
    const ridge = wind.verticalAt(g.x, g.y, g.z);
    if (ridge > 0) ridgeGain += ridge * h;
    g.step(h, { pitch, roll, brake: false }, thermals.liftAt(g) + ridge);
    for (const c of gates.cross(ax, ay, az, g.x, g.y, g.z)) {
      score.gate(c.passed);
      if (c.passed) g.addSpeed(6);
    }
    const ground = field.heightAt(g.x, g.z);
    score.update(h, -g.z, g.y - ground, g.speed);
    if (near.update(h, g, heightAt)) score.nearMiss();
    const ev = clock.update(h, score.distance, (p) => field.difficulty(-p));
    // the closest call: time left just before a checkpoint topped the clock up
    for (const e of ev) if (e.type === 'checkpoint') margin = Math.min(margin, clock.remaining - e.added);
    if (g.y < ground + FLIGHT.crashClearance) {
      cause = 'crash';
      break;
    }
    if (clock.timeUp) {
      cause = 'timeup';
      break;
    }
  }
  return {
    sheet,
    cause,
    time: Math.round(t),
    distance: Math.round(score.distance),
    sectors: clock.sector,
    remaining: Math.round(clock.remaining),
    margin: Math.round(margin * 10) / 10,
    splits: clock.splits.map((x) => Math.round(x * 10) / 10),
    gates: `${score.gatesPassed}/${score.gatesTotal}`,
    near: score.nearMisses,
    ridge: Math.round(ridgeGain),
    score: Math.round(score.score),
  };
}

describe('balance', () => {
  it('an autopilot keeps ahead of the clock for several sectors on any sheet', () => {
    const runs = [427, 1, 77, 2048, 9999].map((s) => fly(s, Number(process.env.SIM_SECONDS ?? 150)));
    process.stdout.write(runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const r of runs) {
      expect(r.cause, `sheet ${r.sheet}`).not.toBe('crash');
      expect(r.sectors, `sheet ${r.sheet}`).toBeGreaterThanOrEqual(4);
      expect(r.distance, `sheet ${r.sheet}`).toBeGreaterThan(8000);
    }
  }, 120_000);

  it('flying high and safe runs out of time', () => {
    const runs = [427, 1, 77, 2048, 9999].map((s) => fly(s, 300, 70));
    process.stdout.write(runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const r of runs) {
      expect(r.cause, `sheet ${r.sheet}`).toBe('timeup');
      expect(r.sectors, `sheet ${r.sheet}`).toBeLessThanOrEqual(3);
    }
  }, 120_000);
});
