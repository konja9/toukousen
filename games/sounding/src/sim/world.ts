import { CONTACT, LAYER, RUN, SONAR, SUB } from '../config';
import { Echo, reach, type Ping } from '../field/echo';
import { clearPath, crossesLayer, floorAt } from '../field/grid';
import type { P3 } from '../field/los';
import { Contact, estimate, hearingRange } from './contacts';
import type { Sector, Survey } from './sector';
import { Sub } from './sub';
import type { Mods } from './upgrades';

/**
 * One sector in play: the sub, the contacts, weapons in the water, mines,
 * survey targets and the exit, plus the echo grid. `step()` advances it by a
 * fixed amount of time for given controls and reports what happened as
 * events (for sound, effects and the HUD). The game, the tests and the bot
 * all drive the same class.
 */

export interface Controls {
  level: number;
  turn: number;
  climb: number;
  ping?: 'omni' | 'cone' | null;
  decoy?: boolean;
}

export interface Weapon {
  kind: 'charge' | 'torpedo';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Charges go off at this height; torpedoes at their aim point. */
  fuseY: number;
  aim: P3;
  alive: boolean;
  by: number;
}

export interface Decoy {
  x: number;
  y: number;
  z: number;
  heading: number;
  until: number;
}

export interface Mine extends P3 {
  alive: boolean;
  litAt: number;
}

export interface SurveyState extends Survey {
  found: boolean;
  litAt: number;
}

export type WorldEvent =
  | { type: 'ping'; ping: Ping; contact?: Contact }
  | { type: 'heard'; contact: Contact; source: 'engine' | 'ping' | 'decoy' }
  | { type: 'relay'; buoy: Contact; to: Contact }
  | { type: 'detected'; contact: Contact }
  | { type: 'lost'; contact: Contact }
  | { type: 'launch'; weapon: Weapon }
  | { type: 'blast'; x: number; y: number; z: number; dist: number; damage: number; kind: 'charge' | 'torpedo' | 'mine' }
  | { type: 'impact'; speed: number }
  | { type: 'survey'; survey: SurveyState }
  | { type: 'spot'; what: 'mine' | 'exit' | 'survey'; x: number; y: number; z: number }
  | { type: 'decoy'; decoy: Decoy }
  | { type: 'cleared' }
  | { type: 'crushed' };

interface PendingDetect {
  contact: Contact;
  ping: Ping;
  range: number;
}

interface PendingReveal {
  t: number;
  kind: 'mine' | 'survey' | 'exit';
  i: number;
}

export interface WorldStats {
  pings: number;
  detections: number;
  maxDepth: number;
}

export class World {
  readonly sub = new Sub();
  readonly contacts: Contact[];
  readonly echo: Echo;
  readonly weapons: Weapon[] = [];
  readonly decoys: Decoy[] = [];
  readonly mines: Mine[];
  readonly surveys: SurveyState[];
  readonly pings: Array<{ ping: Ping; contact?: Contact }> = [];
  exitLitAt = -1e9;
  t = 0;
  status: 'running' | 'cleared' | 'crushed' = 'running';
  decoysLeft: number;
  readonly stats: WorldStats = { pings: 0, detections: 0, maxDepth: 0 };
  /** Track of the sub for the chart: [x, z, exposed?]. */
  readonly track: Array<[number, number, number]> = [];
  private lastPing = -1e9;
  private hearT = 0;
  private trackT = 0;
  private readonly pendingDetect: PendingDetect[] = [];
  private readonly pendingReveal: PendingReveal[] = [];

  constructor(
    readonly sector: Sector,
    readonly mods: Mods,
    state: { hull: number; battery: number; decoys: number },
  ) {
    this.echo = new Echo(sector.floor);
    this.contacts = sector.contacts.map((d, i) => new Contact(d, i, sector.floor));
    this.mines = sector.mines.map((m) => ({ ...m, alive: true, litAt: -1e9 }));
    this.surveys = sector.surveys.map((s) => ({ ...s, found: false, litAt: -1e9 }));
    this.sub.place(sector.entry[0], sector.entryY, sector.entry[1], sector.entryHeading);
    this.sub.hull = state.hull;
    this.sub.battery = state.battery;
    this.decoysLeft = state.decoys;
  }

  get floor(): Float32Array {
    return this.sector.floor;
  }

  get layerY(): number {
    return this.sector.layerY;
  }

  get subPos(): P3 {
    return { x: this.sub.x, y: this.sub.y, z: this.sub.z };
  }

  /** Seconds until the sonar can ping again. */
  get pingCooldown(): number {
    return Math.max(0, SONAR.cooldown - (this.t - this.lastPing));
  }

  get fade(): number {
    return SONAR.fade * this.mods.fadeMul;
  }

  /** Whether any contact is currently hunting or searching. */
  get threat(): 'none' | 'search' | 'hunt' {
    if (this.contacts.some((c) => c.mode === 'hunt')) return 'hunt';
    if (this.contacts.some((c) => c.mode === 'search')) return 'search';
    return 'none';
  }

  /** Contacts whose machinery the sub can hear. */
  audible(): Contact[] {
    return this.contacts.filter((c) => {
      const d = Math.hypot(c.x - this.sub.x, c.y - this.sub.y, c.z - this.sub.z);
      return d < hearingRange(c.loudness, 1, this.sub.y, c.y, this.layerY);
    });
  }

  step(dt: number, c: Controls): WorldEvent[] {
    const ev: WorldEvent[] = [];
    if (this.status !== 'running') return ev;
    this.t += dt;
    const t = this.t;
    const sub = this.sub;

    // --- the sub
    sub.setLevel(c.level);
    const st = sub.step(dt, { turn: c.turn, climb: c.climb }, this.sector.field, this.mods);
    if (st.impact > 0) ev.push({ type: 'impact', speed: st.impact });
    this.stats.maxDepth = Math.max(this.stats.maxDepth, -sub.y);
    this.trackT += dt;
    if (this.trackT > 0.5) {
      this.trackT = 0;
      this.track.push([sub.x, sub.z, sub.y > this.layerY ? 1 : 0]);
    }

    // --- own sonar
    if (c.ping && this.pingCooldown <= 0 && sub.battery >= SONAR.cost) {
      const cone = c.ping === 'cone' && this.mods.cone;
      const dir: [number, number] = [Math.sin(sub.heading), -Math.cos(sub.heading)];
      const ping: Ping = {
        kind: 'own',
        x: sub.x,
        y: sub.y,
        z: sub.z,
        t0: t,
        range: SONAR.range * this.mods.pingRangeMul * (cone ? SONAR.coneRange : 1),
        speed: SONAR.speed,
        ...(cone ? { dir, cos: Math.cos(SONAR.coneHalf) } : {}),
      };
      this.lastPing = t;
      sub.battery -= SONAR.cost;
      this.stats.pings++;
      this.emitPing(ping, ev);
      this.scheduleReveals(ping);
      this.noise(sub, SONAR.noise * this.mods.pingNoiseMul * (cone ? SONAR.coneNoise : 1), 'ping', ev);
    }

    // --- decoys
    if (c.decoy && this.decoysLeft > 0) {
      this.decoysLeft--;
      const d: Decoy = { x: sub.x, y: sub.y, z: sub.z, heading: sub.heading, until: t + 25 };
      this.decoys.push(d);
      ev.push({ type: 'decoy', decoy: d });
    }
    for (const d of this.decoys) {
      if (t > d.until) continue;
      d.x += Math.sin(d.heading) * 4 * dt;
      d.z -= Math.cos(d.heading) * 4 * dt;
      d.y = Math.max(d.y, floorAt(this.floor, d.x, d.z) + 4);
    }

    // --- listening (engine noise twice a second)
    this.hearT += dt;
    if (this.hearT >= 0.5) {
      this.hearT = 0;
      this.noise(sub, sub.noise(this.mods), 'engine', ev);
      for (const d of this.decoys) if (t <= d.until) this.noise(d, SUB.noise[3], 'decoy', ev);
    }

    // --- contacts move and ping
    for (const k of this.contacts) {
      const before = k.mode;
      k.step(dt, t);
      if ((before === 'search' || before === 'hunt') && (k.mode === 'return' || k.mode === 'patrol')) ev.push({ type: 'lost', contact: k });
      if (k.wantsPing(t)) {
        const ping: Ping = { kind: 'enemy', x: k.x, y: k.y, z: k.z, t0: t, range: CONTACT.pingRange, speed: CONTACT.pingSpeed };
        this.emitPing(ping, ev, k);
        this.pendingDetect.push({ contact: k, ping, range: CONTACT.pingRange });
      }
      this.attack(k, ev);
    }

    // --- enemy wavefronts reaching the sub
    for (let i = this.pendingDetect.length - 1; i >= 0; i--) {
      const pd = this.pendingDetect[i];
      const p = pd.ping;
      const front = (t - p.t0) * p.speed;
      const d = Math.hypot(sub.x - p.x, sub.y - p.y, sub.z - p.z);
      if (front < d && front < pd.range) continue;
      this.pendingDetect.splice(i, 1);
      const range = pd.range * (crossesLayer(p.y, sub.y, this.layerY) ? LAYER.attenuation : 1);
      if (d <= range && front >= d && clearPath(this.floor, p, this.subPos)) {
        const fresh = pd.contact.mode !== 'hunt';
        pd.contact.detect(t, this.subPos);
        if (fresh) {
          this.stats.detections++;
          ev.push({ type: 'detected', contact: pd.contact });
        }
        // nearby ships join in
        for (const o of this.contacts) {
          if (o === pd.contact || o.kind === 'buoy') continue;
          if (Math.hypot(o.x - sub.x, o.z - sub.z) < 320) o.alert(t, this.subPos);
        }
      }
    }

    // --- weapons
    for (const w of this.weapons) {
      if (!w.alive) continue;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.z += w.vz * dt;
      const floorY = floorAt(this.floor, w.x, w.z);
      const nearSub = Math.hypot(w.x - sub.x, w.y - sub.y, w.z - sub.z);
      const boom =
        w.kind === 'charge'
          ? w.y <= w.fuseY || w.y <= floorY + 1
          : w.y <= floorY + 1 || nearSub < 6 || Math.hypot(w.x - w.aim.x, w.y - w.aim.y, w.z - w.aim.z) < 3;
      if (boom) {
        w.alive = false;
        this.explode(w.x, w.y, w.z, w.kind, ev);
      }
    }
    for (let i = this.weapons.length - 1; i >= 0; i--) if (!this.weapons[i].alive) this.weapons.splice(i, 1);

    // --- mines
    for (const m of this.mines) {
      if (!m.alive) continue;
      if (Math.hypot(m.x - sub.x, m.y - sub.y, m.z - sub.z) < CONTACT.mineRadius) {
        m.alive = false;
        this.explode(m.x, m.y, m.z, 'mine', ev);
      }
    }

    // --- things lit by our own pings
    for (let i = this.pendingReveal.length - 1; i >= 0; i--) {
      const r = this.pendingReveal[i];
      if (t < r.t) continue;
      this.pendingReveal.splice(i, 1);
      if (r.kind === 'mine') {
        const m = this.mines[r.i];
        if (m.litAt < -1e8) ev.push({ type: 'spot', what: 'mine', x: m.x, y: m.y, z: m.z });
        m.litAt = r.t;
      } else if (r.kind === 'survey') {
        const s = this.surveys[r.i];
        s.litAt = r.t;
        if (!s.found) {
          s.found = true;
          sub.battery = Math.min(this.mods.batteryMax, sub.battery + RUN.surveyBattery);
          ev.push({ type: 'survey', survey: s });
        }
      } else {
        if (this.exitLitAt < -1e8) ev.push({ type: 'spot', what: 'exit', x: this.sector.exit[0], y: this.sector.exitY, z: this.sector.exit[1] });
        this.exitLitAt = r.t;
      }
    }

    this.echo.update(t);
    for (let i = this.pings.length - 1; i >= 0; i--) if ((t - this.pings[i].ping.t0) * this.pings[i].ping.speed > this.pings[i].ping.range + 40) this.pings.splice(i, 1);

    // --- end of the sector
    const [ex, ez] = this.sector.exit;
    if (sub.hull <= 0) {
      this.status = 'crushed';
      ev.push({ type: 'crushed' });
    } else if (Math.hypot(sub.x - ex, sub.z - ez) < RUN.exitRadius && sub.y < this.layerY - 45) {
      this.status = 'cleared';
      ev.push({ type: 'cleared' });
    }
    return ev;
  }

  private emitPing(ping: Ping, ev: WorldEvent[], contact?: Contact): void {
    this.echo.ping(ping);
    this.pings.push({ ping, contact });
    ev.push({ type: 'ping', ping, contact });
  }

  private scheduleReveals(ping: Ping): void {
    this.mines.forEach((m, i) => {
      if (!m.alive) return;
      const at = reach(this.floor, ping, m);
      if (at !== null) this.pendingReveal.push({ t: at, kind: 'mine', i });
    });
    this.surveys.forEach((s, i) => {
      const at = reach(this.floor, ping, s);
      if (at !== null) this.pendingReveal.push({ t: at, kind: 'survey', i });
    });
    const [ex, ez] = this.sector.exit;
    const floorExit = floorAt(this.floor, ex, ez);
    // the exit trench counts as found when the ping reaches its rim or floor
    for (const p of [{ x: ex, y: floorExit + 2, z: ez }, { x: ex, y: this.layerY - 40, z: ez }]) {
      const at = reach(this.floor, ping, p);
      if (at !== null) {
        this.pendingReveal.push({ t: at, kind: 'exit', i: 0 });
        break;
      }
    }
  }

  /** A sound of the given radius at p: every contact that hears it reacts. */
  private noise(p: P3, radius: number, source: 'engine' | 'ping' | 'decoy', ev: WorldEvent[]): void {
    const t = this.t;
    for (const k of this.contacts) {
      const d = Math.hypot(k.x - p.x, k.y - p.y, k.z - p.z);
      if (d > hearingRange(radius, k.ears, k.y, p.y, this.layerY)) continue;
      const est = estimate(p, d, t, k.id);
      if (k.kind === 'buoy') {
        // buoys pass it on to the nearest hunter or ship
        let to: Contact | null = null;
        let best = 460;
        for (const o of this.contacts) {
          if (o.kind === 'buoy') continue;
          const od = Math.hypot(o.x - k.x, o.z - k.z);
          if (od < best) {
            best = od;
            to = o;
          }
        }
        if (to) {
          const was = to.mode;
          to.alert(t, est);
          if (was === 'patrol' || was === 'return') ev.push({ type: 'relay', buoy: k, to });
        }
        continue;
      }
      const was = k.mode;
      k.alert(t, est);
      if (was === 'patrol' || was === 'return') ev.push({ type: 'heard', contact: k, source });
    }
  }

  private attack(k: Contact, ev: WorldEvent[]): void {
    if (k.mode !== 'hunt' || !k.target || this.t < k.attackReady) return;
    const tg = k.target;
    if (k.kind === 'ship') {
      if (Math.hypot(tg.x - k.x, tg.z - k.z) > 16) return;
      k.attackReady = this.t + CONTACT.attackCooldown;
      const s = CONTACT.chargeSpread;
      for (const [ox, oz] of [
        [0, 0],
        [s, 0],
        [-s * 0.5, s * 0.87],
        [-s * 0.5, -s * 0.87],
      ]) {
        const w: Weapon = { kind: 'charge', x: k.x + ox, y: -2, z: k.z + oz, vx: 0, vy: -CONTACT.chargeSink, vz: 0, fuseY: tg.y, aim: { ...tg }, alive: true, by: k.id };
        this.weapons.push(w);
        ev.push({ type: 'launch', weapon: w });
      }
    } else if (k.kind === 'hunter') {
      const d = Math.hypot(tg.x - k.x, tg.y - k.y, tg.z - k.z);
      if (d > 220 || !clearPath(this.floor, k, tg)) return;
      k.attackReady = this.t + CONTACT.attackCooldown * 1.3;
      const v = CONTACT.torpedoSpeed / Math.max(d, 1e-6);
      const w: Weapon = { kind: 'torpedo', x: k.x, y: k.y, z: k.z, vx: (tg.x - k.x) * v, vy: (tg.y - k.y) * v, vz: (tg.z - k.z) * v, fuseY: tg.y, aim: { ...tg }, alive: true, by: k.id };
      this.weapons.push(w);
      ev.push({ type: 'launch', weapon: w });
    }
  }

  private explode(x: number, y: number, z: number, kind: 'charge' | 'torpedo' | 'mine', ev: WorldEvent[]): void {
    const sub = this.sub;
    const dist = Math.hypot(x - sub.x, y - sub.y, z - sub.z);
    const R = kind === 'charge' ? CONTACT.chargeRadius : kind === 'torpedo' ? CONTACT.torpedoRadius * 2 : CONTACT.mineRadius * 2;
    const max = kind === 'charge' ? CONTACT.chargeDamage : kind === 'torpedo' ? CONTACT.torpedoDamage : CONTACT.mineDamage;
    const k = Math.max(0, 1 - dist / R);
    const damage = max * Math.pow(k, 1.5);
    if (damage > 0) sub.hull = Math.max(0, sub.hull - damage);
    ev.push({ type: 'blast', x, y, z, dist, damage, kind });
    // the blast lights up the floor around it like a ping
    const flash: Ping = { kind: 'enemy', x, y, z, t0: this.t, range: 110, speed: SONAR.speed };
    this.echo.ping(flash);
    this.pings.push({ ping: flash });
  }
}
