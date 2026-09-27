// Uniform cubic B-spline over the control-height texture. Mirrors HeightField.sample().
uniform highp sampler2D uField;

vec4 bsW(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  float it = 1.0 - t;
  return vec4(it * it * it, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

float fieldAt(vec2 xz) {
  vec2 uv = (xz + F_HALF) / F_SPACING;
  vec2 cell = floor(uv);
  vec2 t = uv - cell;
  vec4 wx = bsW(t.x);
  vec4 wz = bsW(t.y);
  ivec2 c = ivec2(cell);
  float acc = 0.0;
  for (int b = 0; b < 4; b++) {
    for (int a = 0; a < 4; a++) {
      ivec2 p = clamp(c + ivec2(a - 1, b - 1), ivec2(0), ivec2(F_N - 1));
      acc += wx[a] * wz[b] * texelFetch(uField, p, 0).r;
    }
  }
  return acc;
}
