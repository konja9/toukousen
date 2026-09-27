// Contour-line shading shared by the 3D terrain and the 2D map views.
uniform vec3 uBg;
uniform vec3 uInk;
uniform float uAlt;       // player altitude (m)
uniform float uAltLine;   // 0..1 strength of the altitude line + danger hatching
uniform vec2 uRevealCenter;
uniform float uReveal;    // reveal radius (m) for the draw-in wipe
uniform float uInkGain;   // overall strength of the plain contours
uniform float uHatch;     // strength of the danger hatching

// Anti-aliased iso-line of `v` at integer values, `widthPx` pixels wide.
float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

// Fade lines out before they get dense enough to alias into moire.
float densityFade(float v, float lo, float hi) {
  return 1.0 - smoothstep(lo, hi, fwidth(v));
}

// Ink coverage (0..1) for a surface point at `xz` with height `h`.
float contourInk(vec2 xz, float h, float detail) {
  float v = h / T_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.16, 0.42);
  float vi = v / T_INDEX;
  float major = aaLine(vi, 1.8) * densityFade(vi, 0.12, 0.34);
  float vs = h / T_SUB;
  float sub = aaLine(vs, 1.0) * densityFade(vs, 0.10, 0.28) * detail;
  float ink = max(max(minor * 0.46, major * 0.92), sub * 0.15) * uInkGain;

  if (uAltLine > 0.0) {
    float fh = max(fwidth(h), 1e-4);
    float hd = abs(h - uAlt) / fh;
    float altLine = 1.0 - smoothstep(1.0, 2.2, hd);
    float halo = exp(-hd * 0.2) * 0.3;
    float above = smoothstep(uAlt - fh, uAlt + fh, h);
    float hv = (xz.x + xz.y) / T_HATCH;
    float hatch = aaLine(hv, 1.0) * densityFade(hv, 0.12, 0.35) * above;
    ink = max(ink, uAltLine * uHatch * max(hatch * 0.3, above * 0.05));
    ink = max(ink, uAltLine * max(altLine, halo));
  }
  return ink;
}

// Radial draw-in: 1 inside the reveal radius, with a bright leading edge.
float revealMask(vec2 xz, out float edge) {
  float r = length(xz - uRevealCenter);
  edge = exp(-abs(r - uReveal) / 40.0) * step(r, uReveal + 60.0);
  return 1.0 - smoothstep(uReveal - 90.0, uReveal, r);
}

float applyReveal(float ink, vec2 xz) {
  float edge;
  float m = revealMask(xz, edge);
  return clamp(ink * (m + edge * 2.2), 0.0, 1.0);
}
