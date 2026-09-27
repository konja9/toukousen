import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector4, type WebGLRenderer } from 'three';
import { FIELD_GLSL } from './glsl';
import { shared } from './uniforms';

const fragmentShader = /* glsl */ `
${FIELD_GLSL}
uniform vec3 uBg;
uniform vec3 uInk;
uniform vec2 uCenter;
uniform float uMpp;
uniform vec4 uViewport;
uniform float uOpacity;
float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}
float densityFade(float v, float lo, float hi) { return 1.0 - smoothstep(lo, hi, fwidth(v)); }
void main() {
  vec2 frag = gl_FragCoord.xy - (uViewport.xy + 0.5 * uViewport.zw);
  vec2 xz = uCenter + vec2(frag.x, -frag.y) * uMpp;
  float inside = step(abs(xz.x), F_HALF) * step(abs(xz.y), F_HALF);
  float h = fieldAt(clamp(xz, vec2(-F_HALF), vec2(F_HALF)));
  float v = h / F_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.25, 0.6);
  float major = aaLine(v / F_INDEX, 1.8) * densityFade(v / F_INDEX, 0.2, 0.5);
  float ink = max(minor * 0.42, major * 0.85) * inside;
  vec3 paper = mix(uBg, uInk, 0.035 * inside);
  gl_FragColor = vec4(mix(paper, uInk, ink), uOpacity);
}
`;

export interface MapFrame {
  /** World center (x, z). */
  cx: number;
  cz: number;
  /** Meters per CSS pixel. */
  mpp: number;
  /** CSS px, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

/** North-up orienteering map drawn by a viewport-sized shader quad. */
export class MapView {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uField: shared.uField,
        uBg: shared.uBg,
        uInk: shared.uInk,
        uCenter: { value: new Vector2() },
        uMpp: { value: 1 },
        uViewport: { value: new Vector4() },
        uOpacity: { value: 1 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: WebGLRenderer, f: MapFrame, cssH: number): void {
    const dpr = renderer.getPixelRatio();
    const u = this.material.uniforms;
    const glY = cssH - f.y - f.h;
    u.uCenter.value.set(f.cx, f.cz);
    u.uMpp.value = f.mpp / dpr;
    u.uViewport.value.set(f.x * dpr, glY * dpr, f.w * dpr, f.h * dpr);
    u.uOpacity.value = f.opacity;
    renderer.setViewport(f.x, glY, f.w, f.h);
    renderer.setScissor(f.x, glY, f.w, f.h);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

export function toMap(f: MapFrame, x: number, z: number): [number, number] {
  return [f.x + f.w / 2 + (x - f.cx) / f.mpp, f.y + f.h / 2 + (z - f.cz) / f.mpp];
}
