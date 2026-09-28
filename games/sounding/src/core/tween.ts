export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Shortest signed difference between two angles. */
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
