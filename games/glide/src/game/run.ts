import { NEARMISS, RUN } from '../config';

/** What the run clock reports while it ticks. */
export type ClockEvent =
  | { type: 'checkpoint'; sector: number; split: number; added: number }
  | { type: 'tick'; seconds: number }
  | { type: 'timeup' };

/**
 * Sector time attack: the clock starts with a little time; every checkpoint
 * (one per sector length of progress) adds more, a bit less the harder the
 * course gets. At zero the run is over.
 */
export class RunClock {
  remaining: number = RUN.startTime;
  /** Checkpoints passed. */
  sector = 0;
  elapsed = 0;
  readonly splits: number[] = [];
  private sectorStart = 0;
  private over = false;

  /** Seconds added at the checkpoint that ends a sector, for course difficulty k (0..1). */
  static bonus(k: number): number {
    return RUN.bonus0 + (RUN.bonus1 - RUN.bonus0) * Math.min(Math.max(k, 0), 1);
  }

  get timeUp(): boolean {
    return this.over;
  }

  /** Progress (m) at which the next checkpoint sits. */
  get nextCheckpoint(): number {
    return (this.sector + 1) * RUN.sectorLength;
  }

  /** Time spent in the current sector so far. */
  get sectorTime(): number {
    return this.elapsed - this.sectorStart;
  }

  /**
   * Advance by dt with the course progress (m) reached and a function giving
   * the course difficulty at a progress value.
   */
  update(dt: number, progress: number, difficultyAt: (progress: number) => number): ClockEvent[] {
    const ev: ClockEvent[] = [];
    if (this.over) return ev;
    const before = this.remaining;
    this.elapsed += dt;
    this.remaining -= dt;
    while (progress >= this.nextCheckpoint) {
      this.sector++;
      const split = this.elapsed - this.sectorStart;
      this.splits.push(split);
      this.sectorStart = this.elapsed;
      const added = RunClock.bonus(difficultyAt(this.sector * RUN.sectorLength));
      this.remaining += added;
      ev.push({ type: 'checkpoint', sector: this.sector, split, added });
    }
    if (this.remaining <= RUN.warnTime && this.remaining > 0 && Math.ceil(this.remaining) < Math.ceil(before)) {
      ev.push({ type: 'tick', seconds: Math.ceil(this.remaining) });
    }
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.over = true;
      ev.push({ type: 'timeup' });
    }
    return ev;
  }
}

export interface Body {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}

/**
 * Near misses: terrain at (or just below) our altitude a few meters to the
 * side while flying fast. One per pass, then a short cooldown.
 */
export class NearMiss {
  count = 0;
  private cooldown = 0;

  /** Returns -1 (left), 1 (right) when a near miss happens this step, else 0. */
  update(dt: number, b: Body, heightAt: (x: number, z: number) => number): -1 | 0 | 1 {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || b.speed < NEARMISS.minSpeed) return 0;
    // right-hand direction for a heading yaw (0 = -z, clockwise)
    const rx = Math.cos(b.yaw);
    const rz = Math.sin(b.yaw);
    for (const side of [-1, 1] as const) {
      for (const d of NEARMISS.probes) {
        if (heightAt(b.x + rx * d * side, b.z + rz * d * side) > b.y - NEARMISS.slack) {
          this.cooldown = NEARMISS.cooldown;
          this.count++;
          return side;
        }
      }
    }
    return 0;
  }
}
