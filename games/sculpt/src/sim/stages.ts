import type { Course } from './ball';
import type { Stroke } from './stroke';
import { bump, flat, ridge, sum, tilt, type Shape } from './terrain';

export interface Stage extends Course {
  id: number;
  name: string;
  nameJa: string;
  /** One-line hint shown when the stage opens. */
  hint: string;
  terrain: Shape;
  rock?: Shape;
  soil: number;
  par: number;
  /** A known solution; tests prove every stage is solvable within par. */
  solution: Stroke[];
}

type P = readonly [number, number];

/** Shallow cup around the goal so a slow ball settles in. */
const cup = (g: P): Shape => bump(g[0], g[1], 2.6, -0.9);

/** A mound behind the goal that sends an overshooting ball back toward the cup. */
const backstop = (g: P, dir: P = [1, 0]): Shape => bump(g[0] + dir[0] * 8, g[1] + dir[1] * 8, 4, 3.5);

/** A trench that keeps the ball on a line. */
const lane = (pts: ReadonlyArray<P>, width = 5, depth = 1.6): Shape => ridge(pts, width, -depth);

/** Ground rising toward -x before x0: gives the ball its initial roll. */
const ramp = (x0: number, slope: number): Shape => (x) => Math.max(0, x0 - x) * slope;

/**
 * Lanes slope about 2.5%: just under the static-friction threshold, so a ball
 * at rest stays put but a moving ball keeps coasting.
 */
const COAST = -0.025;

const S = (st: Stage): Stage => ({ ...st, terrain: sum(st.terrain, cup(st.goal)) });

const EW: ReadonlyArray<P> = [
  [-44, 0],
  [44, 0],
];

export const STAGES: Stage[] = [
  S({
    id: 1,
    name: 'FIRST SLOPE',
    nameJa: 'はじめの傾斜',
    hint: '左ドラッグで土を盛る。球の後ろを高くして、ひと押ししよう。',
    start: [-26, 0],
    goal: [26, 0],
    checkpoints: [],
    water: null,
    terrain: sum(tilt(COAST, 0, 6), lane(EW), backstop([26, 0])),
    soil: 500,
    par: 1,
    solution: [{ mode: 'raise', radius: 6, seconds: 1.2, points: [[-31, 0]] }],
  }),
  S({
    id: 2,
    name: 'CUTTING',
    nameJa: '切通し',
    hint: '右ドラッグで土を削る。行く手をふさぐ尾根を切り開こう。',
    start: [-26, 0],
    goal: [26, 0],
    checkpoints: [],
    water: null,
    terrain: sum(
      tilt(-0.08, 0, 9),
      lane(EW, 5, 2),
      ridge(
        [
          [0, -44],
          [0, 44],
        ],
        2.5,
        3,
      ),
      backstop([26, 0]),
    ),
    soil: 0,
    par: 1,
    solution: [{ mode: 'cut', radius: 5, seconds: 1.2, points: [[0, 0]] }],
  }),
  S({
    id: 3,
    name: 'BASIN',
    nameJa: '窪地',
    hint: '球は窪みの底にいる。球の真下を盛り上げて、押し出そう。',
    start: [-22, 0],
    goal: [26, 0],
    checkpoints: [],
    water: null,
    terrain: sum(tilt(-0.085, 0, 10), lane(EW), bump(-22, 0, 4, -2.6), backstop([26, 0])),
    soil: 300,
    par: 1,
    solution: [{ mode: 'raise', radius: 6, seconds: 2, points: [[-23, 0]] }],
  }),
  S({
    id: 4,
    name: 'CUT AND FILL',
    nameJa: '切土と盛土',
    hint: '手持ちの土はゼロ。脇の小山を削り、その土で池を埋めよう。',
    start: [-26, 0],
    goal: [26, 0],
    checkpoints: [],
    water: 3.5,
    terrain: sum(tilt(COAST, 0, 7), ramp(-14, 0.16), lane(EW), bump(2, 0, 4, -5), bump(-4, -22, 7, 6), backstop([26, 0])),
    soil: 0,
    par: 2,
    solution: [
      { mode: 'cut', radius: 7, seconds: 1.5, points: [[-4, -22]] },
      { mode: 'raise', radius: 6, seconds: 2.2, points: [[2, 0]] },
    ],
  }),
  S({
    id: 5,
    name: 'CAUSEWAY',
    nameJa: '土手道',
    hint: '水面より下へ入ると沈む。湖に土を入れて、渡る道をつくろう。',
    start: [-26, 0],
    goal: [26, 0],
    checkpoints: [],
    water: 3.5,
    terrain: sum(
      tilt(COAST, 0, 7),
      ramp(-14, 0.24),
      lane(EW),
      ridge(
        [
          [4, -44],
          [4, 44],
        ],
        3.5,
        -5,
      ),
      bump(-10, -22, 6, 6),
      bump(-10, 22, 6, 6),
      backstop([26, 0]),
    ),
    soil: 0,
    par: 3,
    solution: [
      { mode: 'cut', radius: 6, seconds: 2, points: [[-10, -22]] },
      { mode: 'cut', radius: 6, seconds: 2, points: [[-10, 22]] },
      { mode: 'raise', radius: 6, seconds: 2.2, points: [[0, 0], [8, 0]] },
    ],
  }),
  S({
    id: 6,
    name: 'THE BEND',
    nameJa: '曲がり角',
    hint: '球はまっすぐ進みたがる。角の外側に土手を盛って、向きを変えよう。',
    start: [-26, -18],
    goal: [12, 26],
    checkpoints: [],
    water: null,
    terrain: sum(
      tilt(-0.04, -0.045, 9),
      ramp(-16, 0.08),
      (x) => -Math.max(0, x - 17) * 0.3,
      lane(
        [
          [-44, -18],
          [12, -18],
        ],
        5,
        1.2,
      ),
      lane(
        [
          [12, -18],
          [12, 44],
        ],
        5,
        1.8,
      ),
      backstop([12, 26], [0, 1]),
    ),
    soil: 400,
    par: 1,
    solution: [{ mode: 'raise', radius: 5, seconds: 1.5, points: [[16, -18]] }],
  }),
  S({
    id: 7,
    name: 'BEDROCK',
    nameJa: '岩盤',
    hint: '点描の岩盤は削れない。球の背後を高く盛って、勢いで乗り越えよう。',
    start: [-24, 0],
    goal: [26, 0],
    checkpoints: [],
    water: null,
    terrain: sum(
      tilt(COAST, 0, 7),
      lane(EW),
      ridge(
        [
          [4, -44],
          [4, 44],
        ],
        2.5,
        2.4,
      ),
      bump(-20, -24, 7, 7),
      backstop([26, 0]),
    ),
    rock: (x) => (Math.abs(x - 4) < 6 ? 1 : 0),
    soil: 100,
    par: 2,
    solution: [
      { mode: 'cut', radius: 7, seconds: 2.5, points: [[-20, -24]] },
      { mode: 'raise', radius: 6, seconds: 3, points: [[-26, 0]] },
    ],
  }),
  S({
    id: 8,
    name: 'BENCHMARK',
    nameJa: '水準点',
    hint: '△ の水準点を通ってからでないとゴールに入らない。まっすぐの道をふさごう。',
    start: [-26, 0],
    goal: [26, 0],
    checkpoints: [[0, -13]],
    water: null,
    terrain: sum(
      tilt(COAST, 0, 7),
      ramp(-16, 0.14),
      lane(EW),
      lane(
        [
          [-16, 0],
          [0, -13],
          [16, 0],
        ],
        4,
        1.6,
      ),
      backstop([26, 0]),
    ),
    soil: 300,
    par: 1,
    solution: [{ mode: 'raise', radius: 4, seconds: 1.2, points: [[-8, 2]] }],
  }),
  S({
    id: 9,
    name: 'WATERSHED',
    nameJa: '分水嶺',
    hint: '尾根の上の球は、放っておくと南の湖へ落ちる。北の溝へ押し出し、その先の尾根も切り開こう。',
    start: [-20, 3],
    goal: [24, -24],
    checkpoints: [],
    water: 5,
    terrain: sum(
      flat(10),
      (x, z) => -Math.max(0, z) * 0.18 - Math.max(0, -z) * 0.03 - x * 0.02,
      lane(
        [
          [-20, -6],
          [24, -24],
        ],
        4,
        1.4,
      ),
      ridge(
        [
          [-6, -34],
          [12, 0],
        ],
        2.2,
        2.6,
      ),
      ridge(
        [
          [-30, -12],
          [-6, -21],
        ],
        4,
        2.5,
      ),
      backstop([24, -24], [0.88, -0.48]),
    ),
    soil: 200,
    par: 2,
    solution: [
      { mode: 'raise', radius: 3, seconds: 1.2, points: [[-20, 6]] },
      { mode: 'cut', radius: 5, seconds: 1.3, points: [[3.7, -15.7]] },
    ],
  }),
  S({
    id: 10,
    name: 'SURVEY',
    nameJa: '測量',
    hint: '水準点をめぐり、池を渡ってゴールへ。これまでの技をすべて使おう。',
    start: [-30, 0],
    goal: [30, 0],
    checkpoints: [[-8, -13]],
    water: 3.5,
    terrain: sum(
      tilt(COAST, 0, 8),
      ramp(-22, 0.18),
      (x) => -Math.min(Math.max(x - 6, 0), 8) * 0.13,
      lane(EW),
      lane(
        [
          [-22, 0],
          [-8, -13],
          [6, 0],
        ],
        4,
        1.6,
      ),
      bump(17, 0, 3.8, -5),
      bump(14, -24, 7, 7),
      backstop([30, 0]),
    ),
    soil: 0,
    par: 3,
    solution: [
      { mode: 'cut', radius: 7, seconds: 2, points: [[14, -24]] },
      { mode: 'raise', radius: 4, seconds: 1.2, points: [[-14, 2]] },
      { mode: 'raise', radius: 6, seconds: 2.2, points: [[17, 0]] },
    ],
  }),
];
