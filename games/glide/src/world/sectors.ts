import { RUN, WIND } from '../config';
import { hash01 } from '../core/rng';
import type { TerrainField } from './terrainField';

/**
 * The course is cut into sectors between checkpoints. Each sector has its
 * own wind (mostly across the valley, so one wall is windward) and its own
 * way of laying out the gates. Everything follows from (sheet, sector).
 */

export type GatePattern = 'center' | 'slalom' | 'low' | 'ridge';

export const PATTERN_LABEL: Record<GatePattern, string> = {
  center: 'CENTER LINE',
  slalom: 'SLALOM',
  low: 'LOW LINE',
  ridge: 'RIDGE LINE',
};

export interface SectorInfo {
  index: number;
  /** Direction the air moves (unit, x/z). */
  dirX: number;
  dirZ: number;
  speed: number;
  pattern: GatePattern;
}

const PATTERNS: GatePattern[] = ['center', 'slalom', 'low', 'ridge'];

export class Sectors {
  constructor(
    private readonly field: TerrainField,
    private readonly sheet: number,
    private readonly originZ: number,
  ) {}

  /** Sector index at a course position z (flying towards -z). */
  indexAt(z: number): number {
    return Math.max(0, Math.floor((this.originZ - z) / RUN.sectorLength));
  }

  info(index: number): SectorInfo {
    const s = this.sheet;
    const side = hash01(s, index, 501) < 0.5 ? 1 : -1;
    // heading of the air: straight across the course (+-90 deg from north) with some jitter
    const a = side * (Math.PI / 2) + (hash01(s, index, 502) - 0.5) * 2 * WIND.jitter;
    const zMid = this.originZ - (index + 0.5) * RUN.sectorLength;
    const k = this.field.difficulty(zMid);
    const first = index === 0 ? 0.6 : 1;
    const speed = (WIND.speedMin + (WIND.speedMax - WIND.speedMin) * (0.35 * hash01(s, index, 503) + 0.65 * k)) * first;
    const pattern = index === 0 ? 'center' : PATTERNS[Math.floor(hash01(s, index, 504) * PATTERNS.length)];
    return { index, dirX: Math.sin(a), dirZ: -Math.cos(a), speed, pattern };
  }

  /** Wind vector (m/s, x and z) at z, turning smoothly just after each checkpoint. */
  windAt(z: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    const progress = this.originZ - z;
    const i = this.indexAt(z);
    const cur = this.info(i);
    let x = cur.dirX * cur.speed;
    let wz = cur.dirZ * cur.speed;
    const into = progress - i * RUN.sectorLength;
    if (i > 0 && into < WIND.blend) {
      const prev = this.info(i - 1);
      const t = into / WIND.blend;
      const e = t * t * (3 - 2 * t);
      x = prev.dirX * prev.speed + (x - prev.dirX * prev.speed) * e;
      wz = prev.dirZ * prev.speed + (wz - prev.dirZ * prev.speed) * e;
    }
    out.x = x;
    out.z = wz;
    return out;
  }
}

const POINTS_JA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/** The wind named by where it comes from ("西風", "北東の風"), for air moving along (dirX, dirZ). North is -z. */
export function windName(dirX: number, dirZ: number): string {
  // bearing of the source (opposite of the travel direction): 0 = north (-z), 90 = east (+x)
  const deg = ((Math.atan2(-dirX, dirZ) * 180) / Math.PI + 360) % 360;
  const i = Math.round(deg / 45) % 8;
  return i % 2 ? `${POINTS_JA[i]}の風` : `${POINTS_JA[i]}風`;
}
