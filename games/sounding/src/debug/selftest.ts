import { ColorManagement, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget, WebGLRenderer } from 'three';
import { SONAR } from '../config';
import { Echo } from '../field/echo';
import { FIELD_GLSL, SEA_GLSL } from '../render/glsl';
import { bindEcho, fieldData, fieldTexture, shared } from '../render/uniforms';
import { buildSector } from '../sim/sector';

/**
 * `?selftest` — (1) the GPU B-spline seafloor matches the CPU one; (2) the
 * echo glow the shader reads from the echo textures matches the same glow
 * computed on the CPU from the Echo grid (so what lights up on screen is
 * what the ping actually reached).
 */
export function runSelfTest(root: HTMLElement): void {
  ColorManagement.enabled = false;
  const N = 96;
  const renderer = new WebGLRenderer();
  renderer.setSize(N, N);
  root.appendChild(renderer.domElement);
  const s = buildSector(11, 4);
  fieldData.set(s.field.h);
  fieldTexture.needsUpdate = true;

  const echo = new Echo(s.floor);
  const [ex, ez] = s.entry;
  echo.ping({ kind: 'own', x: ex, y: s.entryY, z: ez, t0: 0, range: SONAR.range, speed: SONAR.speed });
  for (let t = 0; t < 3; t += 0.05) echo.update(t);
  bindEcho(echo.own, echo.enemy, echo.charted);
  const now = 1.2;
  shared.uNow.value = now;
  shared.uFade.value = SONAR.fade;

  const rt = new WebGLRenderTarget(N, N, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const extent = 150;
  const mat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${FIELD_GLSL}
      ${SEA_GLSL}
      uniform vec2 uCenter;
      void main() {
        vec2 xz = uCenter + (floor(gl_FragCoord.xy) + 0.5) / ${N.toFixed(1)} * ${(2 * extent).toFixed(1)} - ${extent.toFixed(1)};
        gl_FragColor = vec4(fieldAt(xz), echoGlow(uEchoOwn, xz), chartMask(xz), 1.0);
      }`,
    uniforms: {
      uField: shared.uField,
      uEchoOwn: shared.uEchoOwn,
      uEchoEnemy: shared.uEchoEnemy,
      uChart: shared.uChart,
      uNow: shared.uNow,
      uFade: shared.uFade,
      uBg: shared.uBg,
      uInk: shared.uInk,
      uCenter: { value: { x: ex, y: ez } },
    },
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

  // CPU glow: the same bilinear blend of per-cell brightness
  const EN = Math.round(Math.sqrt(echo.own.length));
  const glow1 = (tl: number) => {
    const age = now - tl;
    return age < 0 ? 0 : Math.exp(-age * 9) * 1.1 + Math.exp(-age / SONAR.fade) * 0.85;
  };
  const cpuGlow = (x: number, z: number) => {
    const gx = Math.min(Math.max((x + 300) / 4, 0), EN - 1.001);
    const gz = Math.min(Math.max((z + 300) / 4, 0), EN - 1.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const at = (a: number, b: number) => glow1(echo.own[b * EN + a]);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bot - top) * fz;
  };

  let maxErr = 0;
  let agree = 0;
  let litCells = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ex + ((i + 0.5) / N) * 2 * extent - extent;
      const z = ez + ((j + 0.5) / N) * 2 * extent - extent;
      maxErr = Math.max(maxErr, Math.abs(buf[(j * N + i) * 4] - s.field.heightAt(x, z)));
      const gpu = buf[(j * N + i) * 4 + 1] > 0.3;
      const cpu = cpuGlow(x, z) > 0.3;
      if (gpu === cpu) agree++;
      if (cpu) litCells++;
    }
  }
  const agreement = agree / (N * N);
  const result = { samples: N * N, heightMaxErr: maxErr, echoAgreement: agreement, litCells, pass: maxErr < 1e-2 && agreement > 0.98 && litCells > 200 };
  (window as unknown as { __selftest: typeof result }).__selftest = result;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;padding:16px;font:12px monospace;color:#eee;background:#111';
  pre.textContent = JSON.stringify(result, null, 2);
  document.body.appendChild(pre);
}
