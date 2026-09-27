import { PLAYER, WATCH } from '../config';
import type { HeightField } from '../field/heightfield';
import type { Course } from './course';
import { Player } from './player';
import { alertRate, sees, watcherAt } from './watchers';

export interface AutopilotResult {
  finished: boolean;
  /** Running time plus penalties, as the game scores it. */
  time: number;
  caught: number;
}

/**
 * Plays a sheet with the game's rules (movement, watcher timing, alert gauge,
 * respawn grace at the last control) along a given route. Before each short
 * stretch it checks that the stretch stays unlit around the time it gets
 * there, and waits crouched if not. Used to check that sheets are playable
 * and to set par.
 */
export function autopilot(course: Course, field: HeightField, route: Array<Array<[number, number]>>, limit = 1800): AutopilotResult {
  const p = new Player();
  p.place(course.start[0], course.start[1], field);
  const dt = 1 / 30;
  let clock = 0; // the watchers' clock (keeps running on the caught screen)
  let run = 0; // time on the course
  let alert = 0;
  let caught = 0;
  let leg = 0;
  let idx = 1;
  let waited = 0;
  let commit = 0;
  let sinceSpawn = 0;
  let checkpoint: [number, number] = [course.start[0], course.start[1]];
  const seenAt = (x: number, y: number, z: number, time: number) => course.watchers.some((w) => sees(watcherAt(w, time, field), { x, y, z }, field));
  const lit = (x: number, z: number, time: number) => seenAt(x, field.heightAt(x, z) + PLAYER.eyeStand, z, time);
  const nearPatrol = () =>
    course.watchers.some((w) => {
      if (w.kind !== 'patrol') return false;
      const s = watcherAt(w, clock, field);
      return Math.hypot(s.eye.x - p.x, s.eye.z - p.z) < WATCH.hearRadius + 5;
    });
  while (run + caught * WATCH.caughtPenalty < limit) {
    const pts = route[leg];
    if (!pts) break;
    const target = pts[Math.min(idx, pts.length - 1)];
    const dx = target[0] - p.x;
    const dz = target[1] - p.z;
    if (Math.hypot(dx, dz) < 2.2) {
      if (idx >= pts.length - 1) {
        leg++;
        idx = 1;
        checkpoint = [p.x, p.z];
      } else idx++;
      continue;
    }
    const standingSeen = seenAt(p.x, p.y + PLAYER.eyeStand, p.z, clock);
    let wait = false;
    if (commit > 0) commit -= dt;
    else if (standingSeen) {
      // lit where we stand: drop if that hides us, otherwise run for it
      wait = !seenAt(p.x, p.y + PLAYER.eyeCrouch, p.z, clock);
    } else {
      // the next ~12 m of route must stay dark around the time we get to each point
      const span = Math.min(idx + 3, pts.length - 1);
      let dist = 0;
      let px = p.x;
      let pz = p.z;
      outer: for (let k = idx; k <= span; k++) {
        dist += Math.hypot(pts[k][0] - px, pts[k][1] - pz);
        px = pts[k][0];
        pz = pts[k][1];
        const arrive = dist / PLAYER.jog;
        for (let dtA = Math.max(0, arrive - 0.6); dtA <= arrive + 1.5; dtA += 0.3) {
          if (lit(pts[k][0], pts[k][1], clock + dtA)) {
            wait = true;
            break outer;
          }
        }
      }
    }
    waited = wait ? waited + dt : 0;
    if (waited > 30) {
      // no gap is coming: go anyway for a while
      wait = false;
      waited = 0;
      commit = 4;
    }
    const sprint = !wait && standingSeen && !nearPatrol();
    p.step(dt, { dx: wait ? 0 : dx, dz: wait ? 0 : dz, sprint, crouch: wait }, field);
    clock += dt;
    run += dt;
    sinceSpawn += dt;
    let gain = 0;
    for (const w of course.watchers) {
      const s = watcherAt(w, clock, field);
      const eye = { x: p.x, y: p.eyeY, z: p.z };
      const d = Math.hypot(eye.x - s.eye.x, eye.z - s.eye.z);
      if (sees(s, eye, field)) gain += alertRate(d, s.range);
      else if (p.sprinting && d < WATCH.hearRadius) gain += WATCH.hearRate;
    }
    if (sinceSpawn < WATCH.respawnGrace) gain = 0;
    alert = gain > 0 ? Math.min(1, alert + gain * dt) : Math.max(0, alert - WATCH.alertDecay * dt);
    if (alert >= 1) {
      caught++;
      alert = 0;
      p.place(checkpoint[0], checkpoint[1], field);
      idx = 1;
      waited = 0;
      commit = 0;
      sinceSpawn = 0;
      clock += WATCH.caughtScreen;
    }
  }
  return { finished: leg >= route.length, time: run + caught * WATCH.caughtPenalty, caught };
}
