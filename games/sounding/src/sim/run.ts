import { RUN } from '../config';
import { buildSector, type Sector } from './sector';
import { applyAll, offer, type Mods, type UpgradeId } from './upgrades';
import { World } from './world';

/** What is kept of a cleared (or final) sector for the dive log. */
export interface SectorLog {
  index: number;
  layerY: number;
  floor: Float32Array;
  charted: Uint8Array;
  track: Array<[number, number, number]>;
  entry: [number, number];
  exit: [number, number];
  cleared: boolean;
}

export interface DiveTotals {
  sectors: number;
  surveys: number;
  pings: number;
  detections: number;
  maxDepth: number;
  time: number;
}

/**
 * A whole dive: sector after sector from one seed, with hull, battery and
 * refits carried over, until the hull gives out.
 */
export class Dive {
  index = 1;
  owned: UpgradeId[] = [];
  mods: Mods = applyAll([]);
  hull: number;
  battery: number;
  decoysUsed = 0;
  readonly totals: DiveTotals = { sectors: 0, surveys: 0, pings: 0, detections: 0, maxDepth: 0, time: 0 };
  readonly logs: SectorLog[] = [];

  constructor(readonly seed: number) {
    this.hull = this.mods.hullMax;
    this.battery = this.mods.batteryMax;
  }

  get decoys(): number {
    return Math.max(0, this.mods.decoys - this.decoysUsed);
  }

  sector(): Sector {
    return buildSector(this.seed, this.index);
  }

  world(sector: Sector = this.sector()): World {
    return new World(sector, this.mods, { hull: this.hull, battery: this.battery, decoys: this.decoys });
  }

  /** Book-keeping when a sector ends (cleared or not). */
  close(w: World): void {
    const cleared = w.status === 'cleared';
    this.totals.pings += w.stats.pings;
    this.totals.detections += w.stats.detections;
    this.totals.surveys += w.surveys.filter((s) => s.found).length;
    this.totals.maxDepth = Math.max(this.totals.maxDepth, w.stats.maxDepth);
    this.totals.time += w.t;
    this.decoysUsed += this.decoys - w.decoysLeft;
    this.logs.push({
      index: this.index,
      layerY: w.layerY,
      floor: w.sector.floor,
      charted: w.echo.charted.slice(),
      track: w.track.slice(),
      entry: w.sector.entry,
      exit: w.sector.exit,
      cleared,
    });
    this.hull = w.sub.hull;
    this.battery = w.sub.battery;
    if (cleared) {
      this.totals.sectors++;
      this.hull = Math.min(this.mods.hullMax, this.hull + RUN.clearHull);
      this.battery = Math.min(this.mods.batteryMax, this.battery + RUN.clearBattery);
    }
  }

  /** Refits on offer before the next sector. */
  offers(): UpgradeId[] {
    return offer(this.seed, this.index, this.owned);
  }

  /** Take a refit and move on to the next sector. */
  choose(id: UpgradeId | null): void {
    if (id) {
      this.owned.push(id);
      const before = this.mods;
      this.mods = applyAll(this.owned);
      if (id === 'hull') this.hull = this.mods.hullMax;
      if (id === 'battery') this.battery = Math.min(this.mods.batteryMax, this.battery + (this.mods.batteryMax - before.batteryMax));
    }
    this.index++;
  }
}
