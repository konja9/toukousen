import { hash01 } from '../core/rng';

/**
 * Three challenges per sheet. The sheet number decides which kinds and how
 * hard, so a sheet always asks the same things and can be replayed for them.
 */

export type MissionKind = 'distance' | 'skim' | 'chain' | 'ridge' | 'speed' | 'sectors' | 'nearmiss' | 'score';

export interface Mission {
  kind: MissionKind;
  target: number;
  /** Japanese description, e.g. "ゲートを 8 連続で抜ける". */
  label: string;
}

/** What the run has done so far (the trackers' input). */
export interface RunStats {
  distance: number;
  /** Longest unbroken stretch below the skim height (m). */
  skimBest: number;
  bestChain: number;
  /** Total height gained from ridge lift (m). */
  ridgeGain: number;
  maxSpeed: number;
  sectors: number;
  nearMisses: number;
  score: number;
}

/** Height below which flying counts as skimming (m above ground). */
export const SKIM_AGL = 8;

const KINDS: MissionKind[] = ['distance', 'skim', 'chain', 'ridge', 'speed', 'sectors', 'nearmiss', 'score'];

const TARGETS: Record<MissionKind, number[]> = {
  distance: [4000, 5000, 6000, 7000, 8000],
  skim: [250, 300, 350, 400, 450, 500, 600],
  chain: [5, 6, 7, 8, 9, 10, 12],
  ridge: [120, 150, 180, 210, 240, 300],
  speed: [320, 340, 360, 380, 400],
  sectors: [3, 4, 5, 6],
  nearmiss: [5, 7, 9, 12, 15],
  score: [25000, 40000, 60000, 90000],
};

export function missionLabel(kind: MissionKind, target: number): string {
  switch (kind) {
    case 'distance':
      return `${target / 1000} km 飛ぶ`;
    case 'skim':
      return `対地 ${SKIM_AGL} m 未満を ${target} m 続ける`;
    case 'chain':
      return `ゲートを ${target} 連続で抜ける`;
    case 'ridge':
      return `尾根の上昇風で ${target} m 昇る`;
    case 'speed':
      return `時速 ${target} km に達する`;
    case 'sectors':
      return `${target} 区間を通過する`;
    case 'nearmiss':
      return `ニアミス ${target} 回`;
    case 'score':
      return `${target.toLocaleString('en-US')} 点を取る`;
  }
}

export function missionsFor(sheet: number): Mission[] {
  const pool = [...KINDS];
  const out: Mission[] = [];
  for (let k = 0; out.length < 3; k++) {
    const kind = pool.splice(Math.floor(hash01(sheet, k, 301) * pool.length), 1)[0];
    const options = TARGETS[kind];
    const target = options[Math.floor(hash01(sheet, k, 302) * options.length)];
    out.push({ kind, target, label: missionLabel(kind, target) });
  }
  return out;
}

/** The value a run reached for a mission kind. */
export function reached(kind: MissionKind, s: RunStats): number {
  switch (kind) {
    case 'distance':
      return s.distance;
    case 'skim':
      return s.skimBest;
    case 'chain':
      return s.bestChain;
    case 'ridge':
      return s.ridgeGain;
    case 'speed':
      return s.maxSpeed * 3.6;
    case 'sectors':
      return s.sectors;
    case 'nearmiss':
      return s.nearMisses;
    case 'score':
      return s.score;
  }
}

/** Follows the three missions of a sheet through a run. */
export class MissionTracker {
  /** Bit i set: mission i done (in an earlier run or this one). */
  done: number;
  /** Bits completed during this run. */
  fresh = 0;

  constructor(
    readonly missions: Mission[],
    doneBefore = 0,
  ) {
    this.done = doneBefore;
  }

  progress(i: number, s: RunStats): number {
    const m = this.missions[i];
    return Math.min(1, reached(m.kind, s) / m.target);
  }

  /** Check the run stats; returns the indices completed just now. */
  update(s: RunStats): number[] {
    const out: number[] = [];
    this.missions.forEach((m, i) => {
      const bit = 1 << i;
      if (this.fresh & bit) return;
      if (reached(m.kind, s) >= m.target) {
        this.fresh |= bit;
        if (!(this.done & bit)) out.push(i);
        this.done |= bit;
      }
    });
    return out;
  }
}

/** Number of medals (completed missions) over all sheets. */
export function countMedals(medals: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(medals)) for (let b = 0; b < 3; b++) if (v & (1 << b)) n++;
  return n;
}
