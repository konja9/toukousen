import { BALL, FIELD } from '../config';
import type { HeightField, Sample } from '../field/heightfield';

export type BallState = 'idle' | 'rolling' | 'holed' | 'stuck' | 'sunk' | 'out' | 'timeout' | 'unsurveyed';

export interface Course {
  start: readonly [number, number];
  goal: readonly [number, number];
  checkpoints: ReadonlyArray<readonly [number, number]>;
  /** Water surface height, or null for a dry stage. */
  water: number | null;
}

const s: Sample = { h: 0, gx: 0, gz: 0, rock: 0 };

/**
 * A ball rolling on the height field. Motion is integrated in the horizontal
 * plane with the along-slope component of gravity:
 *   a = -(5/7) g grad(h) / (1 + |grad(h)|^2) - rolling friction - damping
 */
export class Ball {
  x = 0;
  z = 0;
  y = 0;
  vx = 0;
  vz = 0;
  state: BallState = 'idle';
  time = 0;
  still = 0;
  reached: boolean[] = [];
  /** Distance travelled (m), used for the rolling sound and stats. */
  travelled = 0;
  /** Recent positions (every 0.5 s) to detect a ball circling in a pit. */
  private recent: Array<[number, number]> = [];
  private recentT = 0;

  reset(course: Course, field: HeightField): void {
    this.x = course.start[0];
    this.z = course.start[1];
    this.vx = 0;
    this.vz = 0;
    this.y = field.heightAt(this.x, this.z);
    this.state = 'idle';
    this.time = 0;
    this.still = 0;
    this.travelled = 0;
    this.recent = [];
    this.recentT = 0;
    this.reached = course.checkpoints.map(() => false);
  }

  release(): void {
    if (this.state === 'idle') this.state = 'rolling';
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get allCheckpoints(): boolean {
    return this.reached.every(Boolean);
  }

  step(dt: number, field: HeightField, course: Course): void {
    if (this.state !== 'rolling') return;
    this.time += dt;
    field.sample(this.x, this.z, s);
    const g = BALL.gravity;
    const denom = 1 + s.gx * s.gx + s.gz * s.gz;
    const ax = (-BALL.rollFactor * g * s.gx) / denom;
    const az = (-BALL.rollFactor * g * s.gz) / denom;
    const slopeAcc = Math.hypot(ax, az);
    const fr = BALL.friction * g;

    if (this.speed < BALL.stopSpeed && slopeAcc <= fr) {
      // static friction holds the ball
      this.vx = 0;
      this.vz = 0;
      this.still += dt;
    } else {
      this.vx += ax * dt;
      this.vz += az * dt;
      // rolling friction + damping shrink the speed but never reverse it
      const sp = this.speed;
      if (sp > 0) {
        const k = Math.max(0, sp - (fr + BALL.damping * sp) * dt) / sp;
        this.vx *= k;
        this.vz *= k;
      }
      const mx = this.vx * dt;
      const mz = this.vz * dt;
      this.x += mx;
      this.z += mz;
      this.travelled += Math.hypot(mx, mz);
      this.still = this.speed < BALL.stopSpeed ? this.still + dt : 0;
    }
    this.y = field.heightAt(this.x, this.z);

    course.checkpoints.forEach(([cx, cz], i) => {
      if (!this.reached[i] && Math.hypot(this.x - cx, this.z - cz) < BALL.checkpointRadius) this.reached[i] = true;
    });

    const dGoal = Math.hypot(this.x - course.goal[0], this.z - course.goal[1]);
    if (this.allCheckpoints) {
      if (dGoal < BALL.holeRadius && this.speed < BALL.captureSpeed) {
        this.state = 'holed';
        return;
      }
      if (dGoal < BALL.holeRestRadius && this.still > 0.3) {
        this.state = 'holed';
        return;
      }
    } else if (dGoal < BALL.holeRadius && this.speed < BALL.captureSpeed) {
      // reached the cup without visiting every benchmark
      this.state = 'unsurveyed';
      return;
    }
    if (Math.abs(this.x) > FIELD.half || Math.abs(this.z) > FIELD.half) {
      this.state = 'out';
      return;
    }
    if (course.water !== null && this.y < course.water - 0.2) {
      this.state = 'sunk';
      return;
    }
    if (this.still > BALL.stillTime || this.circling(dt)) {
      this.state = 'stuck';
      return;
    }
    if (this.time > BALL.maxTime) this.state = 'timeout';
  }

  /** True when the ball has gone nowhere for 8 s (rocking in a pit or creeping to a halt). */
  private circling(dt: number): boolean {
    this.recentT += dt;
    if (this.recentT < 0.5) return false;
    this.recentT = 0;
    this.recent.push([this.x, this.z]);
    if (this.recent.length > 16) this.recent.shift();
    if (this.recent.length < 16) return false;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of this.recent) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    return Math.hypot(x1 - x0, z1 - z0) < 9 && this.speed < 1;
  }
}

export interface SimResult {
  state: BallState;
  path: Array<[number, number]>;
  time: number;
  reached: boolean[];
}

/** Run the ball from the start for up to `seconds`, recording the path every `every` seconds. */
export function simulate(field: HeightField, course: Course, seconds = BALL.maxTime + 1, every = 0.05): SimResult {
  const ball = new Ball();
  ball.reset(course, field);
  ball.release();
  const h = 1 / BALL.stepHz;
  const path: Array<[number, number]> = [[ball.x, ball.z]];
  let acc = 0;
  for (let t = 0; t < seconds && ball.state === 'rolling'; t += h) {
    ball.step(h, field, course);
    acc += h;
    if (acc >= every) {
      acc = 0;
      path.push([ball.x, ball.z]);
    }
  }
  path.push([ball.x, ball.z]);
  return { state: ball.state, path, time: ball.time, reached: ball.reached };
}
