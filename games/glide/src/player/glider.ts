import { FLIGHT as F } from '../config';

export interface GliderInput {
  /** -1 (nose down) .. 1 (nose up) */
  pitch: number;
  /** -1 (left) .. 1 (right) */
  roll: number;
  brake: boolean;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const approach = (x: number, target: number, rate: number, dt: number) =>
  x + (target - x) * (1 - Math.exp(-rate * dt));

/**
 * Point-mass glider with an energy-exchange model:
 *   dv/dt = -g sin(pitch)           (diving trades height for speed)
 *   dy/dt = v sin(pitch) - sink(v) + lift
 * so total energy only drains through the sink polar and is refilled by lift.
 * Heading 0 points to -z (north); positive yaw turns clockwise (east).
 */
export class Glider {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  bank = 0;
  speed: number = F.startSpeed;
  vx = 0;
  vy = 0;
  vz = 0;
  sink = 0;
  stalled = false;
  /** Yaw of the course (valley direction at start); yaw is limited around it. */
  courseYaw = 0;

  reset(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.courseYaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = F.startSpeed;
    this.stalled = false;
    this.updateVelocity(0);
  }

  static sinkRate(speed: number, bank: number, brake: boolean): number {
    const d = speed - F.sinkBestSpeed;
    let s = F.sinkMin + F.sinkK * d * d;
    s /= Math.pow(Math.max(Math.cos(bank), 0.3), 1.5);
    if (brake) s += F.brakeSink;
    return s;
  }

  step(dt: number, input: GliderInput, lift: number): void {
    // Stall handling: below stall speed the nose drops and authority is reduced.
    if (this.speed < F.stallSpeed) this.stalled = true;
    else if (this.speed > F.stallRecover) this.stalled = false;
    const authority = this.stalled ? 0.3 : 1;

    this.bank = approach(this.bank, input.roll * F.maxBank * authority, F.bankResponse, dt);

    if (this.stalled) {
      this.pitch = approach(this.pitch, -0.45, 2.2, dt);
    } else if (input.pitch !== 0) {
      this.pitch += input.pitch * F.pitchRate * dt;
    } else {
      this.pitch = approach(this.pitch, 0, F.pitchReturn, dt);
    }
    this.pitch = clamp(this.pitch, F.pitchMin, F.pitchMax);

    const yawRate = (F.turnGain * F.gravity * Math.tan(this.bank)) / Math.max(this.speed, 20);
    this.yaw = clamp(this.yaw + yawRate * dt, this.courseYaw - F.yawLimit, this.courseYaw + F.yawLimit);

    let dv = -F.gravity * Math.sin(this.pitch);
    if (this.speed > F.cruiseSpeed) dv -= F.dragAboveCruise * (this.speed - F.cruiseSpeed);
    if (input.brake) dv -= F.brakeDrag;
    this.speed = clamp(this.speed + dv * dt, F.minSpeed, F.maxSpeed);

    this.sink = Glider.sinkRate(this.speed, this.bank, input.brake);
    this.updateVelocity(lift);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }

  addSpeed(dv: number): void {
    this.speed = clamp(this.speed + dv, F.minSpeed, F.maxSpeed);
  }

  private updateVelocity(lift: number): void {
    const cp = Math.cos(this.pitch);
    this.vx = Math.sin(this.yaw) * cp * this.speed;
    this.vz = -Math.cos(this.yaw) * cp * this.speed;
    this.vy = Math.sin(this.pitch) * this.speed - this.sink + lift;
  }

  /** Total specific energy (J/kg) — handy for tests and tuning. */
  energy(): number {
    return 0.5 * this.speed * this.speed + F.gravity * this.y;
  }
}
