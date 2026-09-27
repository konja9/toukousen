/** Small vocabulary of terrain shapes used to author stages. All units are meters. */

export type Shape = (x: number, z: number) => number;

export const flat = (h: number): Shape => () => h;

export const tilt = (ax: number, az: number, c = 0): Shape => (x, z) => c + ax * x + az * z;

/** Gaussian hill (h > 0) or pit (h < 0). */
export const bump = (cx: number, cz: number, r: number, h: number): Shape => (x, z) =>
  h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));

function segDist(x: number, z: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(Math.max(((x - x1) * dx + (z - z1) * dz) / len2, 0), 1) : 0;
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}

function polyDist(x: number, z: number, pts: ReadonlyArray<readonly [number, number]>): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

/** Gaussian ridge (h > 0) or trench (h < 0) along a polyline. */
export const ridge = (pts: ReadonlyArray<readonly [number, number]>, width: number, h: number): Shape => (x, z) =>
  h * Math.exp(-(polyDist(x, z, pts) ** 2) / (2 * width * width));

/** 1 inside the polygon-ish region described by a predicate, softened at the edge. */
export const region = (inside: (x: number, z: number) => number): Shape => inside;

export const sum = (...shapes: Shape[]): Shape => (x, z) => shapes.reduce((a, f) => a + f(x, z), 0);
