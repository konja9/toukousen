import { floorAt } from '../field/grid';
import type { Controls, World } from './world';

/**
 * Test pilot: follows the sector's hidden route without pinging, keeps
 * under the layer where the floor allows, slows down when something is
 * listening nearby, waits before an exposed crossing while a ship is close,
 * and runs for it when hunted. Used to check that sectors are fair.
 */
export class Bot {
  private idx = 1;
  private wait = 0;

  controls(w: World, dt: number): Controls {
    const s = w.sector;
    const sub = w.sub;
    const path = s.path;
    while (this.idx < path.length - 1 && Math.hypot(path[this.idx][0] - sub.x, path[this.idx][1] - sub.z) < 9) this.idx++;
    const [tx, tz] = path[this.idx];
    const final = this.idx >= path.length - 2;

    // height: under the layer, but clear of the floor over the next few waypoints
    let floorAhead = floorAt(w.floor, sub.x, sub.z);
    for (let k = this.idx; k < Math.min(this.idx + 4, path.length); k++) floorAhead = Math.max(floorAhead, floorAt(w.floor, path[k][0], path[k][1]));
    const cruise = s.layerY - 7;
    let wantY = Math.max(cruise, floorAhead + 11);
    if (final && Math.hypot(s.exit[0] - sub.x, s.exit[1] - sub.z) < 30) wantY = s.layerY - 70;

    const want = Math.atan2(tx - sub.x, -(tz - sub.z));
    const err = Math.atan2(Math.sin(want - sub.heading), Math.cos(want - sub.heading));
    const turn = Math.max(-1, Math.min(1, err * 2.5));
    const climb = Math.max(-1, Math.min(1, (wantY - sub.y) / 4));

    const heard = w.audible();
    const near = heard.filter((c) => Math.hypot(c.x - sub.x, c.z - sub.z) < 170);
    const exposedAhead = floorAhead + 11 > s.layerY;
    let level = near.length ? 1 : 2;
    if (Math.abs(err) > 1) level = 1;
    if (Math.abs(wantY - sub.y) > 6) level = Math.min(level, 1);
    // hold short of an exposed crossing while a ship is close (but not forever)
    if (exposedAhead && sub.y < s.layerY && near.some((c) => c.kind === 'ship') && this.wait < 40) {
      this.wait += dt;
      level = 0;
    } else if (!exposedAhead) this.wait = 0;
    // a hunter sub on patrol close by: go silent and let it pass
    if (near.some((c) => c.kind === 'hunter' && c.mode === 'patrol' && Math.hypot(c.x - sub.x, c.z - sub.z) < 90)) level = 0;
    if (w.threat === 'hunt') level = Math.abs(err) > 0.5 ? 1 : 2;
    return { level, turn, climb, ping: null };
  }
}

/** Run a world with the bot until it clears, is crushed, or time runs out. */
export function runBot(w: World, limit = 900, dt = 1 / 20): World {
  const bot = new Bot();
  while (w.status === 'running' && w.t < limit) w.step(dt, bot.controls(w, dt));
  return w;
}
