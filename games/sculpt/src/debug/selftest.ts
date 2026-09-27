import { ColorManagement, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget, WebGLRenderer } from 'three';
import { FIELD } from '../config';
import { HeightField } from '../field/heightfield';
import { FIELD_GLSL } from '../render/glsl';
import { fieldData, fieldTexture } from '../render/uniforms';

/** `?selftest` — compare the GPU B-spline surface against the CPU one used by the physics. */
export function runSelfTest(root: HTMLElement): void {
  ColorManagement.enabled = false;
  const N = 64;
  const renderer = new WebGLRenderer();
  renderer.setSize(N, N);
  root.appendChild(renderer.domElement);
  const field = new HeightField();
  field.fill((x, z) => 8 + 5 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 0.05 * x, (x, z) => (x + z > 20 ? 1 : 0));
  for (let k = 0; k < FIELD.N * FIELD.N; k++) {
    fieldData[k * 2] = field.h[k];
    fieldData[k * 2 + 1] = field.rock[k];
  }
  fieldTexture.needsUpdate = true;

  const rt = new WebGLRenderTarget(N, N, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const mat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${FIELD_GLSL}
      void main() {
        vec2 xz = (floor(gl_FragCoord.xy) + vec2(0.37, 0.61)) * (${(2 * FIELD.half).toFixed(1)} / ${N.toFixed(1)}) - ${FIELD.half.toFixed(1)};
        vec2 f = fieldAt(xz);
        gl_FragColor = vec4(f.x, f.y, 0.0, 1.0);
      }`,
    uniforms: { uField: { value: fieldTexture } },
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  renderer.setRenderTarget(rt);
  renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const buf = new Float32Array(N * N * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
  renderer.setRenderTarget(null);

  let maxErr = 0;
  let maxRock = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.37) * ((2 * FIELD.half) / N) - FIELD.half;
      const z = (j + 0.61) * ((2 * FIELD.half) / N) - FIELD.half;
      const s = field.sample(x, z);
      maxErr = Math.max(maxErr, Math.abs(buf[(j * N + i) * 4] - s.h));
      maxRock = Math.max(maxRock, Math.abs(buf[(j * N + i) * 4 + 1] - s.rock));
    }
  }
  const result = { samples: N * N, maxErr, maxRock, pass: maxErr < 1e-3 && maxRock < 1e-3 };
  (window as unknown as { __selftest: typeof result }).__selftest = result;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;padding:16px;font:12px monospace;color:#eee;background:#111';
  pre.textContent = JSON.stringify(result, null, 2);
  document.body.appendChild(pre);
}
