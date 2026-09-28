import { SUB } from '../config';
import type { HeightField } from '../field/heightfield';

export interface SubControl {
  /** -1..1, positive turns clockwise (to starboard). */
  turn: number;
  /** -1..1, positive rises. */
  climb: number;
}

export interface SubMods {
  noiseMul: number;
  drainMul: number;
}

export interface SubStep {
  /** Speed (m/s) of a hit against a wall this step, 0 if none. */
  impact: number;
  scraping: boolean;
}

/**
 * The submarine: four throttle steps, turning that works even when slow,
 * climbing and diving, collisions with the seafloor, battery and noise.
 */
export class Sub {
  x = 0;
  y = -100;
  z = 0;
  /** Radians, 0 = north (-z), clockwise. */
  heading = 0;
  speed = 0;
  vy = 0;
  /** Throttle step 0..3 (stop, slow, half, full). */
  level = 1;
  hull: number = SUB.hull;
  battery: number = SUB.battery;
  scraping = false;

  place(x: number, y: number, z: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.vy = 0;
    this.scraping = false;
  }

  /** Highest step the battery allows. */
  get maxLevel(): number {
    return this.battery > 0 ? 3 : 1;
  }

  setLevel(l: number): void {
    this.level = Math.min(Math.max(Math.round(l), 0), 3);
  }

  /** How far away the engine can be heard (m). */
  noise(mods: SubMods): number {
    const lvl = Math.min(this.level, this.maxLevel);
    return SUB.noise[lvl] * mods.noiseMul + (this.scraping ? 70 : 0);
  }

  step(dt: number, c: SubControl, field: HeightField, mods: SubMods): SubStep {
    const lvl = Math.min(this.level, this.maxLevel);
    const target = SUB.speeds[lvl];
    this.speed += (target - this.speed) * Math.min(1, SUB.accel * dt);
    const turnable = 0.35 + 0.65 * Math.min(Math.abs(this.speed) / 4, 1);
    this.heading += Math.max(-1, Math.min(1, c.turn)) * SUB.turnRate * turnable * dt;
    const wantVy = Math.max(-1, Math.min(1, c.climb)) * SUB.climbRate;
    this.vy += (wantVy - this.vy) * Math.min(1, 2.5 * dt);
    this.battery = Math.max(0, this.battery - SUB.drain[lvl] * mods.drainMul * dt);

    let nx = this.x + Math.sin(this.heading) * this.speed * dt;
    let nz = this.z - Math.cos(this.heading) * this.speed * dt;
    nx = Math.min(Math.max(nx, -SUB.edge), SUB.edge);
    nz = Math.min(Math.max(nz, -SUB.edge), SUB.edge);
    let ny = Math.min(this.y + this.vy * dt, -SUB.minDepth);
    if (ny >= -SUB.minDepth && this.vy > 0) this.vy = 0;

    let impact = 0;
    this.scraping = false;
    const floorNew = field.heightAt(nx, nz) + SUB.radius;
    if (ny < floorNew) {
      const rise = floorNew - this.y;
      if (rise <= Math.max(0.35, Math.abs(this.speed) * dt * 1.1)) {
        // gentle slope: ride up over it
        ny = floorNew;
        this.scraping = Math.abs(this.speed) > 0.5 || this.vy < -0.5;
        if (this.vy < 0) this.vy = 0;
      } else {
        // wall: stop, bounce back a little, take damage for the speed of the hit
        nx = this.x;
        nz = this.z;
        impact = Math.abs(this.speed);
        this.speed *= -0.25;
        const floorHere = field.heightAt(nx, nz) + SUB.radius;
        ny = Math.max(ny, floorHere);
        if (this.vy < 0) {
          impact = Math.max(impact, -this.vy * 0.6);
          this.vy = 0;
        }
        if (impact > 0.8) this.hull = Math.max(0, this.hull - impact * SUB.impactDamage);
        else impact = 0;
      }
    }
    this.x = nx;
    this.y = ny;
    this.z = nz;
    return { impact, scraping: this.scraping };
  }
}
