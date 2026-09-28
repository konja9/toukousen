/**
 * 2D simplex noise — a line-by-line port of Stefan Gustavson / Ashima Arts
 * `snoise(vec2)` (webgl-noise, MIT). The GPU evaluates the same function in
 * shaders/noise.glsl; the permutation steps are rounded to float32 here so
 * that lattice hashing matches the GPU bit-for-bit.
 */

const f32 = Math.fround;
const INV289 = f32(1 / 289);
const C0 = 0.211324865405187; // (3 - sqrt(3)) / 6
const C1 = 0.366025403784439; // (sqrt(3) - 1) / 2
const C2 = -0.577350269189626; // -1 + 2 * C0
const C3 = f32(0.024390243902439); // 1 / 41

function mod289(x: number): number {
  return f32(x - Math.floor(f32(x * INV289)) * 289);
}

function permute(x: number): number {
  return mod289(f32(f32(f32(x * 34) + 10) * x));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

export function snoise(vx: number, vy: number): number {
  const s = (vx + vy) * C1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  const t = (ix + iy) * C0;
  const x0x = vx - ix + t;
  const x0y = vy - iy + t;

  const i1x = x0x > x0y ? 1 : 0;
  const i1y = x0x > x0y ? 0 : 1;

  const x12x = x0x + C0 - i1x;
  const x12y = x0y + C0 - i1y;
  const x12z = x0x + C2;
  const x12w = x0y + C2;

  ix = mod289(ix);
  iy = mod289(iy);
  const p0 = permute(permute(iy) + ix);
  const p1 = permute(permute(iy + i1y) + ix + i1x);
  const p2 = permute(permute(iy + 1) + ix + 1);

  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x12x * x12x + x12y * x12y), 0);
  let m2 = Math.max(0.5 - (x12z * x12z + x12w * x12w), 0);
  m0 *= m0;
  m0 *= m0;
  m1 *= m1;
  m1 *= m1;
  m2 *= m2;
  m2 *= m2;

  const gx0 = 2 * fract(f32(p0 * C3)) - 1;
  const gx1 = 2 * fract(f32(p1 * C3)) - 1;
  const gx2 = 2 * fract(f32(p2 * C3)) - 1;
  const h0 = Math.abs(gx0) - 0.5;
  const h1 = Math.abs(gx1) - 0.5;
  const h2 = Math.abs(gx2) - 0.5;
  const a0 = gx0 - Math.floor(gx0 + 0.5);
  const a1 = gx1 - Math.floor(gx1 + 0.5);
  const a2 = gx2 - Math.floor(gx2 + 0.5);

  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2);

  const g0 = a0 * x0x + h0 * x0y;
  const g1 = a1 * x12x + h1 * x12y;
  const g2 = a2 * x12z + h2 * x12w;

  return 130 * (m0 * g0 + m1 * g1 + m2 * g2);
}
