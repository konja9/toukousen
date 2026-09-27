import { snoise } from '../core/noise';
import { HeightField } from './heightfield';

/**
 * Terrain for a sheet: broad hills and valleys, sharper ridges in places, and
 * small knolls and depressions that give orienteers something to read.
 */
export interface TerrainParams {
  seed: number;
  /** Overall relief multiplier. */
  relief?: number;
  /** Amount of ridged (sharp-crested) terrain, 0..1. */
  ridges?: number;
  /** Amount of small knolls/depressions, 0..1. */
  detail?: number;
}

function seedOffset(seed: number): [number, number] {
  const a = Math.sin(seed * 12.9898 + 3.1) * 43758.5453;
  const b = Math.sin(seed * 78.233 + 1.7) * 24634.6345;
  return [(a - Math.floor(a)) * 90, (b - Math.floor(b)) * 90];
}

function fbm(x: number, y: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * snoise(x, y);
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.03 + 1.7;
    y = ry * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}

function ridged(x: number, y: number): number {
  let s = 0;
  let a = 0.5;
  let w = 1;
  for (let i = 0; i < 4; i++) {
    let n = 1 - Math.abs(snoise(x, y));
    n *= n * w;
    w = Math.min(Math.max(n * 1.6, 0), 1);
    s += a * n;
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.11 - 3.3;
    y = ry * 2.11 + 4.9;
    a *= 0.5;
  }
  return s;
}

export function terrainHeight(p: Required<TerrainParams>, x: number, z: number): number {
  const [ox, oz] = seedOffset(p.seed);
  const px = x / 200 + ox;
  const pz = z / 200 + oz;
  const broad = fbm(px, pz, 4) * 30;
  const mask = Math.min(Math.max(snoise(px * 0.6 + 11, pz * 0.6 - 7) * 0.8 + 0.5, 0), 1);
  const sharp = ridged(px * 1.4 - 5, pz * 1.4 + 3) * 34 * mask * p.ridges;
  const knolls = fbm(x / 48 + ox * 2, z / 48 + oz * 2, 3) * 7 * p.detail;
  return 45 + (broad + sharp + knolls) * p.relief;
}

export function generate(params: TerrainParams): HeightField {
  const p: Required<TerrainParams> = { relief: 1, ridges: 0.7, detail: 1, ...params };
  const f = new HeightField();
  f.fill((x, z) => terrainHeight(p, x, z));
  return f;
}
