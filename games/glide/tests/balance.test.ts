import { describe, expect, it } from 'vitest';
import { FLIGHT } from '../src/config';
import { Glider } from '../src/player/glider';
import { Gates } from '../src/world/gates';
import { TerrainField, seedVector } from '../src/world/terrainField';
import { Thermals } from '../src/world/thermals';
import { ScoreKeeper } from '../src/game/score';

/**
 * Playability check: a simple autopilot that follows the valley and aims for
 * gates must be able to fly a reasonable distance on every sheet. Guards
 * against tuning changes that make the course impossible.
 */
function fly(sheet: number, seconds: number) {
  const field = new TerrainField(seedVector(sheet));
  const thermals = new Thermals();
  const gates = new Gates();
  thermals.reset(field, sheet, 0);
  gates.reset(field, sheet, 0);
  const g = new Glider();
  const x0 = field.valleyCenter(0);
  g.reset(x0, field.heightAt(x0, 0) + FLIGHT.startAGL, 0, field.valleyHeading(0));
  const score = new ScoreKeeper();
  const h = 1 / FLIGHT.stepHz;
  let t = 0;
  for (; t < seconds; t += h) {
    thermals.update(g.z);
    gates.update(g.z, h, t);
    const next = gates.list.find((q) => q.state === 'pending');
    // pure pursuit: the next gate when it is close, else the valley center ahead
    const gateNear = next && next.z < g.z && next.z > g.z - 220;
    const tz = gateNear ? next.z : g.z - 160;
    const tx = gateNear ? next.x : field.valleyCenter(g.z - 160);
    const want = Math.atan2(tx - g.x, g.z - tz);
    const bankWant = Math.max(-1, Math.min(1, (want - g.yaw) * 2.2));
    const roll = Math.max(-1, Math.min(1, (bankWant * 1.05 - g.bank) * 3 + bankWant));
    // hold a target height: gate height, or clear the terrain ahead
    let ahead = 0;
    for (const d of [0, 40, 80, 140]) ahead = Math.max(ahead, field.heightAt(g.x + g.vx * (d / g.speed), g.z + g.vz * (d / g.speed)));
    const targetY = gateNear ? Math.max(next.y, ahead + 8) : ahead + 22;
    const pitchWant = Math.max(-0.35, Math.min(0.3, (targetY - g.y) * 0.02));
    const pitch = Math.max(-1, Math.min(1, (pitchWant - g.pitch) * 4));
    const ax = g.x, ay = g.y, az = g.z;
    g.step(h, { pitch, roll, brake: false }, thermals.liftAt(g));
    for (const c of gates.cross(ax, ay, az, g.x, g.y, g.z)) {
      score.gate(c.passed);
      if (c.passed) g.addSpeed(6);
    }
    const ground = field.heightAt(g.x, g.z);
    score.update(h, -g.z, g.y - ground, g.speed);
    if (g.y < ground + FLIGHT.crashClearance) break;
  }
  return { sheet, time: t, distance: score.distance, gates: `${score.gatesPassed}/${score.gatesTotal}`, score: Math.round(score.score) };
}

describe('balance', () => {
  it('an autopilot can fly several kilometers on any sheet', () => {
    const runs = [427, 1, 77, 2048, 9999].map((s) => fly(s, Number(process.env.SIM_SECONDS ?? 150)));
    process.stdout.write(runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    for (const r of runs) expect(r.distance).toBeGreaterThan(3000);
  });
});
