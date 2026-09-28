import { SUB } from '../config';
import { hash01 } from '../core/rng';

/** Refits offered between sectors (pick one of three). */

export type UpgradeId = 'quiet' | 'sonar' | 'cone' | 'decoy' | 'hull' | 'battery' | 'memory' | 'passive';

export interface Mods {
  noiseMul: number;
  drainMul: number;
  pingRangeMul: number;
  pingNoiseMul: number;
  cone: boolean;
  decoys: number;
  hullMax: number;
  batteryMax: number;
  fadeMul: number;
  passive: boolean;
}

export const baseMods = (): Mods => ({
  noiseMul: 1,
  drainMul: 1,
  pingRangeMul: 1,
  pingNoiseMul: 1,
  cone: false,
  decoys: 0,
  hullMax: SUB.hull,
  batteryMax: SUB.battery,
  fadeMul: 1,
  passive: false,
});

export interface Upgrade {
  id: UpgradeId;
  name: string;
  ja: string;
  desc: string;
  /** Can be taken more than once. */
  stack: boolean;
  apply(m: Mods): void;
}

export const UPGRADES: Upgrade[] = [
  { id: 'quiet', name: 'QUIET SCREW', ja: '静音スクリュー', desc: 'エンジン音が聞こえる距離 −30%', stack: true, apply: (m) => void (m.noiseMul *= 0.7) },
  { id: 'sonar', name: 'HIGH-POWER SONAR', ja: '高出力ソナー', desc: 'ソナーの射程 +30%（音も少し大きくなる）', stack: true, apply: (m) => void ((m.pingRangeMul *= 1.3), (m.pingNoiseMul *= 1.1)) },
  { id: 'cone', name: 'DIRECTIONAL SONAR', ja: '指向性ソナー', desc: 'F キーで前方 50° だけに打つ。遠くまで届き、音は半分', stack: false, apply: (m) => void (m.cone = true) },
  { id: 'decoy', name: 'DECOYS', ja: '囮 ×2', desc: 'X キーで囮を放つ。囮は大きな音を立てて前へ進む', stack: true, apply: (m) => void (m.decoys += 2) },
  { id: 'hull', name: 'HULL PLATING', ja: '船体補強', desc: '船体の上限 +25、全快する', stack: true, apply: (m) => void (m.hullMax += 25) },
  { id: 'battery', name: 'BATTERY BANK', ja: '大容量電池', desc: '電池の上限 +35%、消費 −15%', stack: true, apply: (m) => void ((m.batteryMax *= 1.35), (m.drainMul *= 0.85)) },
  { id: 'memory', name: 'ECHO MEMORY', ja: '残響記憶', desc: '照らした等深線が 2 倍長く残る', stack: true, apply: (m) => void (m.fadeMul *= 2) },
  { id: 'passive', name: 'PASSIVE ARRAY', ja: '受動ソナー強化', desc: '相手の方位に加えて、おおよその距離がわかる', stack: false, apply: (m) => void (m.passive = true) },
];

export const upgradeById = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)!;

export function applyAll(owned: readonly UpgradeId[]): Mods {
  const m = baseMods();
  for (const id of owned) upgradeById(id).apply(m);
  return m;
}

/** Three different refits for the break after sector `index`. */
export function offer(seed: number, index: number, owned: readonly UpgradeId[]): UpgradeId[] {
  const pool = UPGRADES.filter((u) => u.stack || !owned.includes(u.id)).map((u) => u.id);
  const out: UpgradeId[] = [];
  let k = 0;
  while (out.length < 3 && pool.length) {
    const i = Math.floor(hash01(seed, index * 97 + k++, 11) * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
