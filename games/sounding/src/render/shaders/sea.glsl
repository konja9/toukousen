// Isobaths, echo glow and the chart mask.
uniform vec3 uBg;
uniform vec3 uInk;
uniform sampler2D uEchoOwn;
uniform sampler2D uEchoEnemy;
uniform sampler2D uChart;
uniform float uNow;
uniform float uFade;

float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

float densityFade(float v, float lo, float hi) {
  return 1.0 - smoothstep(lo, hi, fwidth(v));
}

/** A single contour at height `at`, `widthPx` wide. */
float levelLine(float h, float at, float widthPx) {
  float fw = max(fwidth(h), 1e-6);
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, abs(h - at) / fw);
}

float isobathInk(float h, float detail) {
  float v = h / F_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.2, 0.55);
  float vi = v / F_INDEX;
  float major = aaLine(vi, 1.8) * densityFade(vi, 0.15, 0.45);
  float vs = h / 2.0;
  float sub = aaLine(vs, 1.0) * densityFade(vs, 0.12, 0.3) * detail;
  return max(max(minor * 0.62, major * 1.0), sub * 0.16);
}

// brightness of an echo cell lit at time tl: a flash as the wavefront passes, then an afterglow
float glow1(float tl) {
  float age = uNow - tl;
  if (age < 0.0) return 0.0;
  return exp(-age * 9.0) * 1.1 + exp(-age / uFade) * 0.85;
}

float echoGlow(sampler2D tex, vec2 xz) {
  vec2 g = clamp((xz + F_HALF) / E_SPACING, vec2(0.0), vec2(float(E_N) - 1.001));
  vec2 c = floor(g);
  vec2 f = g - c;
  ivec2 i = ivec2(c);
  float a = glow1(texelFetch(tex, i, 0).r);
  float b = glow1(texelFetch(tex, i + ivec2(1, 0), 0).r);
  float d = glow1(texelFetch(tex, i + ivec2(0, 1), 0).r);
  float e = glow1(texelFetch(tex, i + ivec2(1, 1), 0).r);
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

float chartMask(vec2 xz) {
  vec2 uv = ((xz + F_HALF) / E_SPACING + 0.5) / float(E_N);
  return texture(uChart, uv).r;
}
