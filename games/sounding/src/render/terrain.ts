import { Mesh, PlaneGeometry, ShaderMaterial, type BufferGeometry } from 'three';
import { FIELD } from '../config';
import { FIELD_GLSL, SEA_GLSL } from './glsl';
import { shared } from './uniforms';

const H = FIELD.half;

const vertexShader = /* glsl */ `
${FIELD_GLSL}
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.y = fieldAt(p.xz);
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${FIELD_GLSL}
${SEA_GLSL}
uniform vec3 uSub;
uniform float uLayer;
uniform float uProx;
uniform float uFogDist;
uniform float uMemory;
varying vec3 vWorld;
void main() {
  vec2 xz = vWorld.xz;
  float h = fieldAt(xz);
  float dist = distance(vec3(xz.x, h, xz.y), cameraPosition);
  float fog = exp(-pow(dist / uFogDist, 2.0));
  float detail = 1.0 - smoothstep(25.0, 90.0, dist);
  float lines = isobathInk(h, detail);

  // what sound has shown us: our own pings, theirs (dashed), what we have charted, and what is close
  float own = echoGlow(uEchoOwn, xz);
  float dash = step(0.42, fract((xz.x - xz.y) / 3.4));
  float enemy = echoGlow(uEchoEnemy, xz) * mix(0.25, 0.9, dash);
  float memory = chartMask(xz) * 0.12 * uMemory;
  float prox = (1.0 - smoothstep(uProx * 0.5, uProx, distance(vec3(xz.x, h, xz.y), uSub))) * 0.6;
  float vis = max(max(own, enemy), max(memory, prox));
  float ink = lines * vis;
  // the wavefront itself washes the floor for a moment
  ink = max(ink, smoothstep(1.05, 1.7, own) * 0.22);

  // the isobath at the sub's depth: where the floor becomes a wall
  float lit = clamp(vis * 1.6, 0.0, 1.0);
  ink = max(ink, levelLine(h, uSub.y, 2.4) * lit);
  // floor higher than the sub: hatched
  float hatch = aaLine((xz.x + xz.y) / 2.8, 1.0) * densityFade((xz.x + xz.y) / 2.8, 0.2, 0.5);
  ink = max(ink, step(uSub.y, h) * hatch * 0.3 * vis);
  // the thermocline isobath, dashed
  float ldash = step(0.5, fract((xz.x * 0.8 + xz.y) / 7.0));
  ink = max(ink, levelLine(h, uLayer, 2.0) * ldash * lit * 0.9);

  ink = clamp(ink, 0.0, 1.0) * fog;
  gl_FragColor = vec4(mix(uBg, uInk, ink), 1.0);
}
`;

export function terrainGeometry(segments = 240): BufferGeometry {
  const g = new PlaneGeometry(2 * H, 2 * H, segments, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Terrain {
  readonly mesh: Mesh;

  constructor(geometry: BufferGeometry) {
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uField: shared.uField,
          uEchoOwn: shared.uEchoOwn,
          uEchoEnemy: shared.uEchoEnemy,
          uChart: shared.uChart,
          uNow: shared.uNow,
          uFade: shared.uFade,
          uBg: shared.uBg,
          uInk: shared.uInk,
          uSub: shared.uSub,
          uLayer: shared.uLayer,
          uProx: shared.uProx,
          uFogDist: shared.uFogDist,
          uMemory: shared.uMemory,
        },
      }),
    );
    this.mesh.frustumCulled = false;
  }
}
