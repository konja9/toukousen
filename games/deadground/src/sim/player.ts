import { PLAYER } from '../config';
import type { HeightField, Sample } from '../field/heightfield';

export type Posture = 'stand' | 'crouch';

export interface MoveInput {
  /** Desired direction in world space (need not be normalized; zero = stop). */
  dx: number;
  dz: number;
  sprint: boolean;
  crouch: boolean;
}

const s: Sample = { h: 0, gx: 0, gz: 0 };

/**
 * Walking on the height field: slower uphill, blocked by cliffs (sliding along
 * the contour instead), clamped to the map sheet.
 */
export class Player {
  x = 0;
  z = 0;
  y = 0;
  vx = 0;
  vz = 0;
  /** Facing, radians, 0 = north (-z), clockwise. */
  facing = 0;
  posture: Posture = 'stand';
  sprinting = false;
  /** Distance walked, for footstep sounds. */
  walked = 0;

  place(x: number, z: number, field: HeightField, facing = 0): void {
    this.x = x;
    this.z = z;
    this.y = field.heightAt(x, z);
    this.vx = 0;
    this.vz = 0;
    this.facing = facing;
    this.posture = 'stand';
  }

  get eyeY(): number {
    return this.y + (this.posture === 'crouch' ? PLAYER.eyeCrouch : PLAYER.eyeStand);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  step(dt: number, input: MoveInput, field: HeightField): void {
    this.posture = input.crouch ? 'crouch' : 'stand';
    const len = Math.hypot(input.dx, input.dz);
    let tx = 0;
    let tz = 0;
    this.sprinting = false;
    if (len > 1e-6) {
      let ux = input.dx / len;
      let uz = input.dz / len;
      field.sample(this.x, this.z, s);
      let up = s.gx * ux + s.gz * uz;
      if (up > PLAYER.maxSlope) {
        // too steep: follow the contour in the direction closest to the input
        const gl = Math.hypot(s.gx, s.gz);
        const cx = -s.gz / gl;
        const cz = s.gx / gl;
        const sign = cx * ux + cz * uz >= 0 ? 1 : -1;
        ux = cx * sign;
        uz = cz * sign;
        up = 0;
      }
      this.sprinting = input.sprint && !input.crouch;
      const base = input.crouch ? PLAYER.crouch : this.sprinting ? PLAYER.sprint : PLAYER.jog;
      const slow = Math.min(Math.max(1 - Math.max(up, 0) * 0.75 + Math.max(-up, 0) * 0.1, 0.5), 1.08);
      tx = ux * base * slow;
      tz = uz * base * slow;
      const want = Math.atan2(ux, -uz);
      const d = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
      this.facing += d * Math.min(1, PLAYER.turnRate * dt);
    }
    const k = Math.min(1, PLAYER.accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    const nx = Math.min(Math.max(this.x + this.vx * dt, -PLAYER.edge), PLAYER.edge);
    const nz = Math.min(Math.max(this.z + this.vz * dt, -PLAYER.edge), PLAYER.edge);
    this.walked += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx;
    this.z = nz;
    this.y = field.heightAt(this.x, this.z);
  }
}
