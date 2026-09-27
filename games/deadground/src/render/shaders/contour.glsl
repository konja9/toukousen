// Contour shading (orienteering interval) and the watchers' viewshed.
uniform vec3 uBg;
uniform vec3 uInk;
uniform float uReveal;
uniform vec2 uRevealCenter;

float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

float densityFade(float v, float lo, float hi) {
  return 1.0 - smoothstep(lo, hi, fwidth(v));
}

float contourInk(float h, float detail) {
  float v = h / F_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.2, 0.5);
  float vi = v / F_INDEX;
  float major = aaLine(vi, 1.8) * densityFade(vi, 0.15, 0.4);
  float vs = h;
  float sub = aaLine(vs, 1.0) * densityFade(vs, 0.12, 0.3) * detail;
  return max(max(minor * 0.55, major * 0.95), sub * 0.14);
}

// ---- viewshed: distance maps of all watchers packed side by side in one atlas
uniform sampler2D uVAtlas;
uniform int uVCount;
uniform vec3 uVEye[W_MAX];
uniform vec2 uVDir[W_MAX];
uniform float uVCos[W_MAX];
uniform float uVRange[W_MAX];
uniform mat4 uVMat[W_MAX];

// 0..1: how much of this ground point any watcher sees (3x3 filtered, so the
// boundary of the lit area is soft instead of stair-stepped).
float watched(vec3 wp) {
  float seen = 0.0;
  vec2 texel = vec2(1.0 / (float(W_MAX) * 512.0), 1.0 / 1024.0);
  for (int i = 0; i < W_MAX; i++) {
    if (i >= uVCount) break;
    vec3 d = wp - uVEye[i];
    float hd = length(d.xz);
    if (hd > uVRange[i] || hd < 0.01) continue;
    if (dot(d.xz / hd, uVDir[i]) < uVCos[i]) continue;
    vec4 p = uVMat[i] * vec4(wp, 1.0);
    if (p.w <= 0.0) continue;
    vec2 uv = p.xy / p.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    float dist = length(d);
    float bias = 0.6 + dist * 0.012;
    vec2 base = vec2((float(i) + clamp(uv.x, 0.002, 0.998)) / float(W_MAX), uv.y);
    float lit = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        float stored = texture(uVAtlas, base + vec2(float(dx), float(dy)) * texel).r;
        lit += dist <= stored + bias ? 1.0 : 0.0;
      }
    }
    // fade out at the edge of the cone and at the end of the range
    float coneEdge = smoothstep(uVCos[i], uVCos[i] + 0.012, dot(d.xz / hd, uVDir[i]));
    float rangeEdge = 1.0 - smoothstep(uVRange[i] - 4.0, uVRange[i], hd);
    seen = max(seen, lit / 9.0 * coneEdge * rangeEdge);
  }
  return seen;
}

float applyReveal(float ink, vec2 xz) {
  float r = length(xz - uRevealCenter);
  float edge = exp(-abs(r - uReveal) / 18.0) * step(r, uReveal + 30.0);
  float m = 1.0 - smoothstep(uReveal - 40.0, uReveal, r);
  return clamp(ink * (m + edge * 2.0), 0.0, 1.0);
}
