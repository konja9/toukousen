import { NEARMISS, SCORE } from '../config';

export function lowMultiplier(agl: number): number {
  for (const [maxAgl, mult] of SCORE.lowTiers) if (agl < maxAgl) return mult;
  return 1;
}

/** Scoring: forward progress x low-altitude multiplier, plus gate bonuses scaled by chain. */
export class ScoreKeeper {
  score = 0;
  /** Furthest progress along the course (m). */
  distance = 0;
  mult = 1;
  chain = 0;
  bestChain = 0;
  gatesPassed = 0;
  gatesTotal = 0;
  minAGL = Infinity;
  maxSpeed = 0;
  time = 0;
  lastGateBonus = 0;
  nearMisses = 0;

  update(dt: number, progress: number, agl: number, speed: number): void {
    this.time += dt;
    this.mult = lowMultiplier(agl);
    if (progress > this.distance) {
      this.score += (progress - this.distance) * this.mult;
      this.distance = progress;
    }
    if (agl < this.minAGL) this.minAGL = agl;
    if (speed > this.maxSpeed) this.maxSpeed = speed;
  }

  /** Register a gate result; returns the bonus awarded. */
  gate(passed: boolean): number {
    this.gatesTotal++;
    if (!passed) {
      this.chain = 0;
      this.lastGateBonus = 0;
      return 0;
    }
    this.gatesPassed++;
    this.chain++;
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.lastGateBonus = SCORE.gateBase * this.chain;
    this.score += this.lastGateBonus;
    return this.lastGateBonus;
  }

  /** A near miss at the current multiplier; returns the points awarded. */
  nearMiss(): number {
    this.nearMisses++;
    const pts = NEARMISS.points * this.mult;
    this.score += pts;
    return pts;
  }
}
