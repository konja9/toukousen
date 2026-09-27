import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { FIELD } from '../config';
import { CONTOUR_GLSL, FIELD_GLSL } from './glsl';
import { shared } from './uniforms';

/**
 * The terrain rendered as a floating contour model: the surface with contour
 * lines, strata lines on the side walls, and a hatched water plane.
 */

const H = FIELD.half;

const surfaceVert = /* glsl */ `
${FIELD_GLSL}
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.y = fieldAt(p.xz).x;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const surfaceFrag = /* glsl */ `
${FIELD_GLSL}
${CONTOUR_GLSL}
varying vec3 vWorld;
void main() {
  vec2 f = fieldAt(vWorld.xz);
  float ink = applyReveal(contourInk(vWorld.xz, f.x, f.y), vWorld.xz);
  gl_FragColor = vec4(mix(uBg, uInk, ink), 1.0);
}
`;

// Side walls: top vertices follow max(terrain, water), bottom sits on the base.
const wallVert = /* glsl */ `
${FIELD_GLSL}
uniform float uWater;
attribute float aTop;
varying vec3 vWorld;
varying float vGround;
void main() {
  vec3 p = position;
  float g = fieldAt(p.xz).x;
  vGround = g;
  p.y = aTop > 0.5 ? max(g, uWater) : ${FIELD.base.toFixed(1)};
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const wallFrag = /* glsl */ `
uniform vec3 uBg;
uniform vec3 uInk;
uniform float uReveal;
varying vec3 vWorld;
varying float vGround;
float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}
void main() {
  float y = vWorld.y;
  float strata = max(aaLine(y / ${FIELD.interval.toFixed(1)}, 1.0) * 0.28, aaLine(y / ${(FIELD.interval * FIELD.indexEvery).toFixed(1)}, 1.4) * 0.5);
  // water section of the wall: horizontal hatch instead of strata
  float water = step(vGround, y - 0.02);
  float hatch = aaLine(y / 0.35, 1.0) * 0.22;
  float ink = mix(strata, hatch, water);
  float shown = smoothstep(0.0, 60.0, uReveal);
  vec3 wallBg = mix(uBg, uInk, 0.035);
  gl_FragColor = vec4(mix(wallBg, uInk, ink * shown), 1.0);
}
`;

const waterFrag = /* glsl */ `
${FIELD_GLSL}
uniform vec3 uBg;
uniform vec3 uInk;
uniform float uTime;
uniform float uWater;
varying vec3 vWorld;
float aaLine(float v, float widthPx) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}
void main() {
  float g = fieldAt(vWorld.xz).x;
  if (g > uWater) discard;
  float depth = uWater - g;
  float wave = vWorld.z + sin(vWorld.x * 0.35 + uTime * 0.8) * 0.25;
  float hatch = aaLine(wave / 2.2, 1.0) * (0.12 + 0.1 * smoothstep(0.0, 3.0, depth));
  gl_FragColor = vec4(mix(uBg, uInk, hatch), 0.86);
}
`;

const waterVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function surfaceGeometry(segments: number): BufferGeometry {
  const g = new PlaneGeometry(2 * H, 2 * H, segments, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

function wallGeometry(segments: number): BufferGeometry {
  // four sides, each a strip of quads, wound to face outward
  const sides: Array<[number, number, number, number]> = [
    [-H, H, H, H], // south (z = +H), west -> east
    [H, H, H, -H], // east
    [H, -H, -H, -H], // north
    [-H, -H, -H, H], // west
  ];
  const pos: number[] = [];
  const top: number[] = [];
  const idx: number[] = [];
  for (const [x0, z0, x1, z1] of sides) {
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      pos.push(x, 0, z, x, 0, z);
      top.push(1, 0);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aTop', new BufferAttribute(new Float32Array(top), 1));
  g.setIndex(idx);
  return g;
}

export class Model {
  readonly group = new Group();
  readonly water: Mesh;

  constructor() {
    const common = {
      uField: shared.uField,
      uBg: shared.uBg,
      uInk: shared.uInk,
      uReveal: shared.uReveal,
    };
    const surface = new Mesh(
      surfaceGeometry(192),
      new ShaderMaterial({
        vertexShader: surfaceVert,
        fragmentShader: surfaceFrag,
        uniforms: {
          ...common,
          uBallH: shared.uBallH,
          uBallLine: shared.uBallLine,
          uWater: shared.uWater,
          uRevealCenter: shared.uRevealCenter,
        },
      }),
    );
    surface.frustumCulled = false;

    const walls = new Mesh(
      wallGeometry(160),
      new ShaderMaterial({ vertexShader: wallVert, fragmentShader: wallFrag, uniforms: { ...common, uWater: shared.uWater }, side: DoubleSide }),
    );
    walls.frustumCulled = false;

    const wg = new PlaneGeometry(2 * H, 2 * H, 1, 1);
    wg.rotateX(-Math.PI / 2);
    this.water = new Mesh(
      wg,
      new ShaderMaterial({
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        depthWrite: false,
        uniforms: { uField: shared.uField, uBg: shared.uBg, uInk: shared.uInk, uTime: shared.uTime, uWater: shared.uWater },
      }),
    );
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;

    this.group.add(surface, walls, this.water);
  }

  setWater(level: number | null): void {
    shared.uWater.value = level ?? -1000;
    this.water.visible = level !== null;
    if (level !== null) this.water.position.y = level;
  }
}
