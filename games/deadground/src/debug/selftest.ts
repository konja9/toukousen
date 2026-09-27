import { ColorManagement, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget, WebGLRenderer } from 'three';
import { generate } from '../field/generate';
import { CONTOUR_GLSL, FIELD_GLSL } from '../render/glsl';
import { terrainGeometry } from '../render/terrain';
import { fieldData, fieldTexture, shared } from '../render/uniforms';
import { Viewshed } from '../render/viewshed';
import { sees, watcherAt, type WatcherDef } from '../sim/watchers';

/**
 * `?selftest` — (1) the GPU B-spline surface matches the CPU one; (2) the
 * hatched viewshed on the ground agrees with the CPU line-of-sight test that
 * decides detection.
 */
export function runSelfTest(root: HTMLElement): void {
  ColorManagement.enabled = false;
  const N = 96;
  const renderer = new WebGLRenderer();
  renderer.setSize(N, N);
  root.appendChild(renderer.domElement);
  const field = generate({ seed: 4 });
  fieldData.set(field.h);
  fieldTexture.needsUpdate = true;

  const watchers: WatcherDef[] = [
    { kind: 'tower', x: 20, z: -30, mode: 'spin', speed: 0.5, phase: 1 },
    { kind: 'tower', x: -90, z: 60, mode: 'sweep', from: 0.2, to: 2.4, period: 10, phase: 3 },
  ];
  const states = watchers.map((w) => watcherAt(w, 2.3, field));
  const viewshed = new Viewshed(terrainGeometry());
  viewshed.update(renderer, states);

  const rt = new WebGLRenderTarget(N, N, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  const extent = 200;
  const mat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${FIELD_GLSL}
      ${CONTOUR_GLSL}
      void main() {
        vec2 xz = (floor(gl_FragCoord.xy) + 0.5) / ${N.toFixed(1)} * ${(2 * extent).toFixed(1)} - ${extent.toFixed(1)};
        float h = fieldAt(xz);
        gl_FragColor = vec4(h, watched(vec3(xz.x, h, xz.y)), 0.0, 1.0);
      }`,
    uniforms: {
      uField: shared.uField,
      uBg: shared.uBg,
      uInk: shared.uInk,
      uReveal: shared.uReveal,
      uRevealCenter: shared.uRevealCenter,
      uVAtlas: shared.uVAtlas,
      uVCount: shared.uVCount,
      uVEye: shared.uVEye,
      uVDir: shared.uVDir,
      uVCos: shared.uVCos,
      uVRange: shared.uVRange,
      uVMat: shared.uVMat,
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

  let maxErr = 0;
  let agree = 0;
  let watchedCells = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 * extent - extent;
      const z = ((j + 0.5) / N) * 2 * extent - extent;
      const h = field.heightAt(x, z);
      maxErr = Math.max(maxErr, Math.abs(buf[(j * N + i) * 4] - h));
      const gpu = buf[(j * N + i) * 4 + 1] >= 0.5;
      // a point just above the ground, as the ground hatch represents
      const cpu = states.some((s) => sees(s, { x, y: h + 0.3, z }, field));
      if (gpu === cpu) agree++;
      if (cpu) watchedCells++;
    }
  }
  const agreement = agree / (N * N);
  const result = { samples: N * N, heightMaxErr: maxErr, viewshedAgreement: agreement, watchedCells, pass: maxErr < 1e-3 && agreement > 0.97 && watchedCells > 50 };
  (window as unknown as { __selftest: typeof result }).__selftest = result;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;padding:16px;font:12px monospace;color:#eee;background:#111';
  pre.textContent = JSON.stringify(result, null, 2);
  document.body.appendChild(pre);
}
