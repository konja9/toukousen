import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector4, type WebGLRenderer } from 'three';
import { FIELD_GLSL, SEA_GLSL } from './glsl';
import { shared } from './uniforms';

const fragmentShader = /* glsl */ `
${FIELD_GLSL}
${SEA_GLSL}
uniform vec2 uCenter;
uniform float uMpp;
uniform vec4 uViewport;
uniform float uOpacity;
uniform float uLayer;
uniform float uReveal;
void main() {
  vec2 frag = gl_FragCoord.xy - (uViewport.xy + 0.5 * uViewport.zw);
  vec2 xz = uCenter + vec2(frag.x, -frag.y) * uMpp;
  float inside = step(abs(xz.x), F_HALF) * step(abs(xz.y), F_HALF);
  vec2 cxz = clamp(xz, vec2(-F_HALF), vec2(F_HALF));
  float h = fieldAt(cxz);
  float known = max(chartMask(cxz), uReveal) * inside;
  float v = h / F_INTERVAL;
  float minor = aaLine(v, 1.0) * densityFade(v, 0.25, 0.6);
  float major = aaLine(v / F_INDEX, 1.8) * densityFade(v / F_INDEX, 0.2, 0.5);
  float ink = max(minor * 0.45, major * 0.9) * known;
  // the thermocline isobath, dashed and heavier: the walls of the hidden channels
  float lfw = max(fwidth(h), 1e-6);
  float layerLine = (1.0 - smoothstep(0.6, 1.5, abs(h - uLayer) / lfw)) * 0.9;
  float along = step(0.35, fract((xz.x + xz.y) / (7.0 * max(uMpp, 0.5))));
  ink = max(ink, layerLine * along * known);
  // water deeper than the layer: a faint wash (where a sub can hide)
  float deep = step(h, uLayer - 14.0) * known;
  // unknown sea: a sparse dot grid
  vec2 gp = abs(fract(xz / 25.0 + 0.5) - 0.5) * 25.0;
  float dots = (1.0 - smoothstep(0.4, 1.0, length(gp) / max(uMpp, 0.2))) * (1.0 - known) * inside * 0.35;
  vec3 paper = mix(uBg, uInk, 0.035 * inside + deep * 0.05);
  float a = max(ink, dots);
  gl_FragColor = vec4(mix(paper, uInk, a), uOpacity);
}
`;

export interface ChartFrame {
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
  /** 1 shows the whole seafloor (the dive log), 0 only what has been charted. */
  reveal?: number;
}

/** North-up chart drawn by a viewport-sized shader quad, masked by what has been measured. */
export class ChartView {
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
        uEchoOwn: shared.uEchoOwn,
        uEchoEnemy: shared.uEchoEnemy,
        uChart: shared.uChart,
        uNow: shared.uNow,
        uFade: shared.uFade,
        uBg: shared.uBg,
        uInk: shared.uInk,
        uLayer: shared.uLayer,
        uCenter: { value: new Vector2() },
        uMpp: { value: 1 },
        uViewport: { value: new Vector4() },
        uOpacity: { value: 1 },
        uReveal: { value: 0 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: WebGLRenderer, f: ChartFrame, cssH: number): void {
    const dpr = renderer.getPixelRatio();
    const u = this.material.uniforms;
    const glY = cssH - f.y - f.h;
    u.uCenter.value.set(f.cx, f.cz);
    u.uMpp.value = f.mpp / dpr;
    u.uViewport.value.set(f.x * dpr, glY * dpr, f.w * dpr, f.h * dpr);
    u.uOpacity.value = f.opacity;
    u.uReveal.value = f.reveal ?? 0;
    renderer.setViewport(f.x, glY, f.w, f.h);
    renderer.setScissor(f.x, glY, f.w, f.h);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

export function toChart(f: ChartFrame, x: number, z: number): [number, number] {
  return [f.x + f.w / 2 + (x - f.cx) / f.mpp, f.y + f.h / 2 + (z - f.cz) / f.mpp];
}
