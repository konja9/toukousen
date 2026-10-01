import { WIND } from '../config';
import type { Sectors } from './sectors';
import type { TerrainField } from './terrainField';

/**
 * Ridge lift. Wind blowing into a slope is pushed upward; wind leaving a
 * slope sinks. The vertical air speed is the wind times the slope along the
 * wind, strongest at the surface and fading with height above ground:
 *
 *   w = gain * U * slopeAlongWind * exp(-agl / decay)
 *
 * with a larger gain on the windward side (lift) than on the lee (sink).
 * airflow.ts evaluates the same formula on the GPU for the visible streaks.
 */

const tmp = { x: 0, z: 0 };

export function slopeAlong(field: TerrainField, x: number, z: number, dx: number, dz: number): number {
  const e = WIND.slopeStep;
  const gx = (field.heightAt(x + e, z) - field.heightAt(x - e, z)) / (2 * e);
  const gz = (field.heightAt(x, z + e) - field.heightAt(x, z - e)) / (2 * e);
  return gx * dx + gz * dz;
}

/** Vertical air speed from the wind at a point (m/s, + = up), given the wind vector there. */
export function ridgeLift(field: TerrainField, wx: number, wz: number, x: number, y: number, z: number): number {
  const U = Math.hypot(wx, wz);
  if (U < 1e-3) return 0;
  const s = Math.max(-WIND.maxSlope, Math.min(WIND.maxSlope, slopeAlong(field, x, z, wx / U, wz / U)));
  const agl = Math.max(0, y - field.heightAt(x, z));
  const fade = Math.exp(-agl / WIND.decay);
  return (s > 0 ? WIND.liftGain : WIND.sinkGain) * U * s * fade;
}

export class Wind {
  constructor(
    private readonly field: TerrainField,
    readonly sectors: Sectors,
  ) {}

  /** Wind vector at z (m/s). */
  at(z: number): { x: number; z: number } {
    return this.sectors.windAt(z, { x: 0, z: 0 });
  }

  verticalAt(x: number, y: number, z: number): number {
    const w = this.sectors.windAt(z, tmp);
    return ridgeLift(this.field, w.x, w.z, x, y, z);
  }
}
