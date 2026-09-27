import { Mesh, PlaneGeometry, ShaderMaterial, type BufferGeometry } from 'three';
import { FIELD } from '../config';
import { CONTOUR_GLSL, FIELD_GLSL } from './glsl';
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
${CONTOUR_GLSL}
uniform float uFogDist;
uniform float uTime;
varying vec3 vWorld;
void main() {
  float h = fieldAt(vWorld.xz);
  float dist = distance(vWorld, cameraPosition);
  float fog = exp(-pow(dist / uFogDist, 2.2));
  float detail = 1.0 - smoothstep(20.0, 80.0, dist);
  float ink = contourInk(h, detail);

  // watched ground: diagonal hatch, a faint wash and a bright boundary
  float vis = watched(vec3(vWorld.x, h, vWorld.z));
  float hv = (vWorld.x + vWorld.z) / 2.4 + uTime * 0.6;
  float hatch = aaLine(hv, 1.0) * densityFade(hv, 0.15, 0.45);
  float lit = smoothstep(0.25, 0.75, vis);
  ink = max(ink, lit * max(hatch * 0.55, 0.11));

  ink = applyReveal(ink, vWorld.xz) * fog;
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
          uBg: shared.uBg,
          uInk: shared.uInk,
          uReveal: shared.uReveal,
          uRevealCenter: shared.uRevealCenter,
          uFogDist: shared.uFogDist,
          uTime: shared.uTime,
          uVAtlas: shared.uVAtlas,
          uVCount: shared.uVCount,
          uVEye: shared.uVEye,
          uVDir: shared.uVDir,
          uVCos: shared.uVCos,
          uVRange: shared.uVRange,
          uVMat: shared.uVMat,
        },
      }),
    );
    this.mesh.frustumCulled = false;
  }
}
