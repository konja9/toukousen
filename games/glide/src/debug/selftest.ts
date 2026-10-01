import {
  ColorManagement,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { HEIGHT_GLSL, WIND_GLSL } from '../world/glsl';
import { TerrainField, seedVector } from '../world/terrainField';
import { ridgeLift } from '../world/wind';

/**
 * `?selftest` — evaluates terrainHeight() and ridgeLift() on the GPU at many
 * points and compares them against the CPU ports used by the flight model.
 * Results go to the page and `window.__selftest`.
 */
export function runSelfTest(root: HTMLElement): void {
  ColorManagement.enabled = false;
  const N = 64; // grid of N x N samples
  const renderer = new WebGLRenderer();
  renderer.setSize(N, N);
  root.appendChild(renderer.domElement);

  const rt = new WebGLRenderTarget(N, N, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const material = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${HEIGHT_GLSL}
      ${WIND_GLSL}
      uniform vec2 uOrigin;
      uniform float uStep;
      uniform vec2 uWind;
      void main() {
        vec2 cell = floor(gl_FragCoord.xy);
        vec2 xz = uOrigin + cell * uStep;
        float h = terrainHeight(xz);
        // the ridge lift at a few heights above the ground (0..42 m)
        float agl = mod(cell.x + cell.y, 8.0) * 6.0;
        gl_FragColor = vec4(h, ridgeLift(vec3(xz.x, h + agl, xz.y), uWind), 0.0, 1.0);
      }`,
    uniforms: {
      uSeed: { value: new Vector2() },
      uOrigin: { value: new Vector2() },
      uStep: { value: 1 },
      uWind: { value: new Vector2() },
    },
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const buf = new Float32Array(N * N * 4);

  const cases: Array<{ sheet: number; ox: number; oz: number; step: number; wind: [number, number] }> = [
    { sheet: 427, ox: -1500, oz: -1500, step: 47, wind: [9, 2] },
    { sheet: 1, ox: -300, oz: -12000, step: 13, wind: [-11, -4] },
    { sheet: 9999, ox: 2000, oz: -30000, step: 91, wind: [6, -7] },
    { sheet: 5150, ox: -64, oz: -64, step: 2, wind: [-13, 1] },
  ];

  let maxErr = 0;
  let sumErr = 0;
  let count = 0;
  let worst = '';
  let windMax = 0;
  let windSum = 0;
  let windWorst = '';
  for (const c of cases) {
    const seed = seedVector(c.sheet);
    const field = new TerrainField(seed);
    material.uniforms.uSeed.value.set(seed[0], seed[1]);
    material.uniforms.uOrigin.value.set(c.ox, c.oz);
    material.uniforms.uStep.value = c.step;
    material.uniforms.uWind.value.set(c.wind[0], c.wind[1]);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
    renderer.setRenderTarget(null);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const gpu = buf[(j * N + i) * 4];
        const x = c.ox + i * c.step;
        const z = c.oz + j * c.step;
        const cpu = field.heightAt(x, z);
        const err = Math.abs(gpu - cpu);
        sumErr += err;
        count++;
        if (err > maxErr) {
          maxErr = err;
          worst = `sheet ${c.sheet} (${x}, ${z}) gpu=${gpu.toFixed(3)} cpu=${cpu.toFixed(3)}`;
        }
        const agl = ((i + j) % 8) * 6;
        const wGpu = buf[(j * N + i) * 4 + 1];
        const wCpu = ridgeLift(field, c.wind[0], c.wind[1], x, cpu + agl, z);
        const we = Math.abs(wGpu - wCpu);
        windSum += we;
        if (we > windMax) {
          windMax = we;
          windWorst = `sheet ${c.sheet} (${x}, ${z}, agl ${agl}) gpu=${wGpu.toFixed(3)} cpu=${wCpu.toFixed(3)}`;
        }
      }
    }
  }

  const wind = { maxErr: windMax, meanErr: windSum / count, worst: windWorst, pass: windMax < 0.5 };
  const result = { samples: count, maxErr, meanErr: sumErr / count, worst, wind, pass: maxErr < 0.5 && wind.pass };
  (window as unknown as { __selftest: typeof result }).__selftest = result;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;padding:16px;font:12px monospace;color:#eee;background:#111';
  pre.textContent = JSON.stringify(result, null, 2);
  document.body.appendChild(pre);
}
