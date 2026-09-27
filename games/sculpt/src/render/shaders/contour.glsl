// Contour shading, adapted from CONTOUR GLIDE.
uniform vec3 uBg;
uniform vec3 uInk;
uniform float uBallH;     // height of the ball: its contour glows
uniform float uBallLine;  // 0..1
uniform float uWater;     // water level, or -1000
uniform vec2 uRevealCenter;
uniform float uReveal;

float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

float densityFade(float v, float lo, float hi) {
  return 1.0 - smoothstep(lo, hi, fwidth(v));
}

// Ink coverage for a terrain point.
float contourInk(vec2 xz, float h, float rock) {
  float v = h / F_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.2, 0.5);
  float vi = v / F_INDEX;
  float major = aaLine(vi, 1.8) * densityFade(vi, 0.15, 0.4);
  float vs = h / (F_INTERVAL * 0.5);
  float sub = aaLine(vs, 1.0) * densityFade(vs, 0.12, 0.3);
  float ink = max(max(minor * 0.5, major * 0.95), sub * 0.16);

  // bedrock: a regular stipple
  if (rock > 0.02) {
    vec2 g = fract(xz / 1.1) - 0.5;
    float fwd = fwidth(xz.x) / 1.1;
    float dotv = 1.0 - smoothstep(0.12, 0.12 + fwd * 1.5, length(g));
    ink = max(ink, dotv * 0.55 * smoothstep(0.2, 0.6, rock));
  }

  // the ball's own contour: ground inside it is higher than the ball
  if (uBallLine > 0.0) {
    float fh = max(fwidth(h), 1e-4);
    float hd = abs(h - uBallH) / fh;
    float line = 1.0 - smoothstep(0.6, 1.6, hd);
    float halo = exp(-hd * 0.35) * 0.14;
    ink = max(ink, uBallLine * max(line * 0.85, halo));
  }

  // shoreline
  if (uWater > -100.0) {
    float fh = max(fwidth(h), 1e-4);
    float sd = abs(h - uWater) / fh;
    ink = max(ink, (1.0 - smoothstep(0.8, 2.0, sd)) * 0.9);
  }
  return ink;
}

float applyReveal(float ink, vec2 xz) {
  float r = length(xz - uRevealCenter);
  float edge = exp(-abs(r - uReveal) / 6.0) * step(r, uReveal + 10.0);
  float m = 1.0 - smoothstep(uReveal - 14.0, uReveal, r);
  return clamp(ink * (m + edge * 2.0), 0.0, 1.0);
}
