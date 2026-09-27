import type { FeatureKind } from '../field/features';
import type { TerrainParams } from '../field/generate';
import type { WatcherDef } from './watchers';

export interface Control {
  x: number;
  z: number;
  kind: FeatureKind;
}

/** One sheet: terrain seed, the orienteering course and its watchers. */
export interface Course {
  id: number;
  name: string;
  nameJa: string;
  brief: string;
  terrain: TerrainParams;
  start: readonly [number, number];
  controls: Control[];
  finish: readonly [number, number];
  watchers: WatcherDef[];
  /** Target time (s) for the best rating. */
  par: number;
}
