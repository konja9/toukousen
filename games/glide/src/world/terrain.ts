import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from 'three';
import { CONTOUR_GLSL, HEIGHT_GLSL } from './glsl';
import { shared } from './uniforms';

const vertexShader = /* glsl */ `
${HEIGHT_GLSL}
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = terrainHeight(wp.xz);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${HEIGHT_GLSL}
${CONTOUR_GLSL}
uniform float uFogDist;
varying vec3 vWorld;
void main() {
  // Height is re-evaluated per pixel so contours stay smooth regardless of mesh density.
  float h = terrainHeight(vWorld.xz);
  float dist = distance(vWorld, cameraPosition);
  float fog = exp(-pow(dist / uFogDist, 2.2));
  float detail = 1.0 - smoothstep(60.0, 260.0, dist);
  float ink = applyReveal(contourInk(vWorld.xz, h, detail), vWorld.xz) * fog;
  gl_FragColor = vec4(mix(uBg, uInk, ink), 1.0);
}
`;

/**
 * Square grid whose vertices are denser near the center:
 * x = R * (a*u + (1-a)*u^3), u in [-1, 1].
 */
function buildGrid(size: number, segments: number, a: number): BufferGeometry {
  const R = size / 2;
  const n = segments + 1;
  const coords = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / segments) * 2 - 1;
    coords[i] = R * (a * u + (1 - a) * u * u * u);
  }
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = coords[i];
      pos[k + 1] = 0;
      pos[k + 2] = coords[j];
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let q = 0;
  // Rows from +z to -z: the camera mostly looks north (-z), so this is
  // roughly front-to-back and early depth rejection skips hidden fragments.
  for (let j = segments - 1; j >= 0; j--) {
    for (let i = 0; i < segments; i++) {
      const v00 = j * n + i;
      const v10 = v00 + 1;
      const v01 = v00 + n;
      const v11 = v01 + 1;
      idx[q++] = v00;
      idx[q++] = v01;
      idx[q++] = v10;
      idx[q++] = v10;
      idx[q++] = v01;
      idx[q++] = v11;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  return geo;
}

export class Terrain {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly snap = 5;

  constructor(size = 3400, segments = 320) {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSeed: shared.uSeed,
        uBg: shared.uBg,
        uInk: shared.uInk,
        uAlt: shared.uAlt,
        uAltLine: shared.uAltLine,
        uRevealCenter: shared.uRevealCenter,
        uReveal: shared.uReveal,
        uInkGain: shared.uInkGain,
        uHatch: shared.uHatch,
        uFogDist: shared.uFogDist,
      },
    });
    this.mesh = new Mesh(buildGrid(size, segments, 0.22), material);
    this.mesh.frustumCulled = false;
  }

  /** Keep the dense center of the grid under the viewer. */
  follow(x: number, z: number): void {
    const s = this.snap;
    this.mesh.position.set(Math.round(x / s) * s, 0, Math.round(z / s) * s);
  }
}
