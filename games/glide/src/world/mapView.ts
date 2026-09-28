import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector4, WebGLRenderer } from 'three';
import { CONTOUR_GLSL, HEIGHT_GLSL } from './glsl';
import { shared } from './uniforms';

const vertexShader = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
${HEIGHT_GLSL}
${CONTOUR_GLSL}
uniform vec2 uCenter;
uniform float uMpp;       // meters per device pixel
uniform float uHeading;   // map rotation: screen-up points along this heading
uniform vec4 uViewport;   // device px, origin bottom-left
uniform float uCircle;
uniform float uOpacity;
void main() {
  vec2 frag = gl_FragCoord.xy - (uViewport.xy + 0.5 * uViewport.zw);
  float circ = 1.0;
  if (uCircle > 0.5) {
    float radius = 0.5 * min(uViewport.z, uViewport.w);
    circ = 1.0 - smoothstep(radius - 1.5, radius, length(frag));
    if (circ <= 0.0) discard;
  }
  vec2 s = frag * uMpp;
  float c = cos(uHeading);
  float sn = sin(uHeading);
  vec2 xz = uCenter + vec2(s.x * c + s.y * sn, s.x * sn - s.y * c);
  float h = terrainHeight(xz);
  float ink = applyReveal(contourInk(xz, h, 1.0), xz);
  gl_FragColor = vec4(mix(uBg, uInk, ink), uOpacity * circ);
}
`;

export interface MapFrame {
  /** World-space center (x, z). */
  cx: number;
  cz: number;
  /** Meters per CSS pixel. */
  mpp: number;
  heading: number;
  /** Viewport in CSS px, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  circle: boolean;
  opacity: number;
  altLine: number;
}

/** Top-down topographic map rendered by a full-viewport shader quad. */
export class MapView {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSeed: shared.uSeed,
        uBg: shared.uBg,
        uInk: shared.uInk,
        uAlt: shared.uAlt,
        uAltLine: { value: 0 },
        uRevealCenter: shared.uRevealCenter,
        uReveal: shared.uReveal,
        uInkGain: shared.uInkGain,
        uHatch: shared.uHatch,
        uCenter: { value: new Vector2() },
        uMpp: { value: 1 },
        uHeading: { value: 0 },
        uViewport: { value: new Vector4() },
        uCircle: { value: 0 },
        uOpacity: { value: 1 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: WebGLRenderer, f: MapFrame, cssHeight: number): void {
    const dpr = renderer.getPixelRatio();
    const u = this.material.uniforms;
    const glY = cssHeight - f.y - f.h;
    u.uCenter.value.set(f.cx, f.cz);
    u.uMpp.value = f.mpp / dpr;
    u.uHeading.value = f.heading;
    u.uViewport.value.set(f.x * dpr, glY * dpr, f.w * dpr, f.h * dpr);
    u.uCircle.value = f.circle ? 1 : 0;
    u.uOpacity.value = f.opacity;
    u.uAltLine.value = f.altLine;

    renderer.setViewport(f.x, glY, f.w, f.h);
    renderer.setScissor(f.x, glY, f.w, f.h);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

/** World (x, z) -> CSS px inside a map frame. */
export function mapToScreen(f: MapFrame, x: number, z: number): [number, number] {
  const dx = x - f.cx;
  const dz = z - f.cz;
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  const sx = dx * c + dz * s;
  const sy = dx * s - dz * c;
  return [f.x + f.w / 2 + sx / f.mpp, f.y + f.h / 2 - sy / f.mpp];
}
