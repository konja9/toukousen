import { BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial, Vector2, Vector3 } from 'three';
import { HEIGHT_GLSL, WIND_GLSL } from './glsl';
import { shared } from './uniforms';

/**
 * Airflow streaks: short lines drifting with the wind near the ground. Each
 * one leans by the ridge lift where it is (computed on the GPU with the same
 * formula as the flight model), so the air visibly climbs the windward slopes
 * and pours down the lee ones. Replaces the old floating dust.
 */

const COUNT = 1100;
/** Horizontal size of the box of streaks around the camera (m). */
const BOX = 260;
/** Streaks sit up to this high above the ground (m). */
const TOP = 150;
/** Seconds a streak travels before it starts over. */
const LIFE = 3.2;

const vertexShader = /* glsl */ `
${HEIGHT_GLSL}
${WIND_GLSL}
attribute float aEnd;
attribute float aSeed;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uTime;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  const float box = ${BOX.toFixed(1)};
  vec2 xz = mod(position.xz - uCam.xz + box * 0.5, box) - box * 0.5 + uCam.xz;
  vec3 base = vec3(xz.x, terrainHeight(xz) + position.y, xz.y);
  float w = ridgeLift(base, uWind);
  float U = length(uWind);
  // the vertical is exaggerated a little so the lean reads from the cockpit
  vec3 flow = vec3(uWind.x, w * 1.6, uWind.y);
  float speed = length(flow);
  vec3 dir = speed > 1e-3 ? flow / speed : vec3(0.0, 1.0, 0.0);
  float life = fract(uTime / ${LIFE.toFixed(1)} + aSeed);
  float len = 4.0 + speed * 1.2;
  vec3 wp = base + dir * (life * ${LIFE.toFixed(1)} * speed + len * aEnd);
  vec2 off = abs(xz - uCam.xz);
  float edge = 1.0 - smoothstep(box * 0.3, box * 0.48, max(off.x, off.y));
  float strength = 0.5 + 0.5 * smoothstep(0.4, 4.0, abs(w));
  vAlpha = edge * strength * sin(life * 3.14159) * aEnd * smoothstep(0.5, 3.0, U);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInk;
uniform float uFogDist;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float dist = distance(vWorld, cameraPosition);
  float fog = exp(-pow(dist / uFogDist, 2.2));
  float near = smoothstep(4.0, 24.0, dist);
  gl_FragColor = vec4(uInk, vAlpha * fog * near * uOpacity);
}
`;

export class Airflow {
  readonly object: LineSegments<BufferGeometry, ShaderMaterial>;
  private readonly material: ShaderMaterial;

  constructor() {
    const pos = new Float32Array(COUNT * 2 * 3);
    const end = new Float32Array(COUNT * 2);
    const seed = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * BOX;
      const z = Math.random() * BOX;
      const agl = 2 + Math.pow(Math.random(), 1.7) * TOP;
      const s = Math.random();
      for (let e = 0; e < 2; e++) {
        const k = i * 2 + e;
        pos[k * 3] = x;
        pos[k * 3 + 1] = agl;
        pos[k * 3 + 2] = z;
        end[k] = e;
        seed[k] = s;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new BufferAttribute(end, 1));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSeed: shared.uSeed,
        uInk: shared.uInk,
        uFogDist: shared.uFogDist,
        uTime: shared.uTime,
        uCam: { value: new Vector3() },
        uWind: { value: new Vector2() },
        uOpacity: { value: 0 },
      },
    });
    this.object = new LineSegments(geo, this.material);
    this.object.frustumCulled = false;
  }

  update(camera: Vector3, windX: number, windZ: number, opacity: number): void {
    const u = this.material.uniforms;
    (u.uCam.value as Vector3).copy(camera);
    (u.uWind.value as Vector2).set(windX, windZ);
    u.uOpacity.value = opacity;
  }
}
