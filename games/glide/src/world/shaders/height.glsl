// Terrain height field. Mirrored on the CPU by src/world/terrainField.ts.
// T_* constants are injected from src/config.ts.
uniform vec2 uSeed;

float tFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * snoise(p);
    p = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

float tRidged(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  float w = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(snoise(p));
    n *= n;
    n *= w;
    w = clamp(n * 1.6, 0.0, 1.0);
    s += a * n;
    p = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.11 + vec2(-3.3, 4.9);
    a *= 0.5;
  }
  return s;
}

float valleyCenter(float z) {
  return T_VALLEY_AMP * sin(z / T_VALLEY_WAVE + uSeed.x * 6.0)
       + T_VALLEY_NOISE_AMP * snoise(vec2(z / T_VALLEY_NOISE_WAVE, 7.1 + uSeed.y));
}

float terrainHeight(vec2 xz) {
  float k = smoothstep(0.0, T_DIFF_DIST, -xz.y);
  vec2 p = xz / T_SCALE + uSeed;

  float hills = tFbm(p * T_HILL_FREQ);
  float mask = smoothstep(-0.35, 0.55, snoise(p * T_MASK_FREQ + vec2(31.7, -12.3)));
  float ridge = tRidged(p * T_RIDGE_FREQ + vec2(-5.1, 7.7));
  float amp = mix(T_MOUNT_AMP0, T_MOUNT_AMP1, k);
  float h = T_BASE + hills * T_HILL_AMP + ridge * (0.25 + 0.75 * mask) * amp;

  float cx = valleyCenter(xz.y);
  float halfW = mix(T_HALFW0, T_HALFW1, k);
  float dx = abs(xz.x - cx);
  float floorH = T_FLOOR_BASE
               + T_FLOOR_AMP * (1.0 + k) * snoise(vec2(xz.y / T_FLOOR_WAVE + uSeed.x, 3.3 + uSeed.y))
               + T_DETAIL_AMP * snoise(xz / T_DETAIL_WAVE + uSeed * 3.0);
  float t = smoothstep(halfW * 0.3, halfW * 2.0, dx);
  return mix(floorH + dx * 0.12, h, t);
}
