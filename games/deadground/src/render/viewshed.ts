import {
  Color,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type WebGLRenderer,
} from 'three';
import { WATCH } from '../config';
import type { WatcherState } from '../sim/watchers';
import { FIELD_GLSL } from './glsl';
import { shared } from './uniforms';

const SIZE = 512;
const HEIGHT = 1024;
const W = WATCH.maxWatchers;

const distVert = /* glsl */ `
${FIELD_GLSL}
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.y = fieldAt(p.xz);
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const distFrag = /* glsl */ `
uniform vec3 uEye;
varying vec3 vWorld;
void main() { gl_FragColor = vec4(distance(vWorld, uEye), 0.0, 0.0, 1.0); }
`;

/**
 * Renders, for every watcher, the distance from its eye to the first terrain
 * surface in each direction of its view. The ground shader compares against
 * these maps to hatch the ground the watcher can see (like shadow mapping).
 */
export class Viewshed {
  readonly target = new WebGLRenderTarget(SIZE * W, HEIGHT, { type: FloatType, format: RedFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
  private readonly scene = new Scene();
  private readonly material: ShaderMaterial;
  private readonly cams: PerspectiveCamera[] = [];
  private readonly look = new Vector3();
  private readonly prevClear = new Color();
  private readonly vp = new Matrix4();

  constructor(geometry: BufferGeometry) {
    this.material = new ShaderMaterial({
      vertexShader: distVert,
      fragmentShader: distFrag,
      uniforms: { uField: shared.uField, uEye: { value: new Vector3() } },
    });
    const mesh = new Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    for (let i = 0; i < W; i++) this.cams.push(new PerspectiveCamera(90, 1, 0.3, 400));
    shared.uVAtlas.value = this.target.texture;
  }

  update(renderer: WebGLRenderer, states: WatcherState[]): void {
    const n = Math.min(states.length, W);
    shared.uVCount.value = n;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(this.prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.clearColor();
    renderer.clearDepth();
    for (let i = 0; i < n; i++) {
      const s = states[i];
      const cam = this.cams[i];
      // fit the vertical field to the ground this watcher can see: from just
      // above the horizon down to the ground a few meters in front of it
      const hfov = s.halfAngle * 2 + 0.2;
      const above = s.kind === 'tower' ? WATCH.towerHeight : WATCH.patrolEye;
      const nearDepression = Math.atan2(above + 4, 10);
      const top = 0.06;
      const vfov = nearDepression + top;
      cam.fov = (vfov * 180) / Math.PI;
      cam.aspect = Math.tan(hfov / 2) / Math.tan(vfov / 2);
      cam.far = s.range * 1.6;
      cam.updateProjectionMatrix();
      const dx = Math.sin(s.heading);
      const dz = -Math.cos(s.heading);
      const pitch = top - vfov / 2;
      cam.position.set(s.eye.x, s.eye.y, s.eye.z);
      this.look.set(s.eye.x + dx * Math.cos(pitch), s.eye.y + Math.sin(pitch), s.eye.z + dz * Math.cos(pitch));
      cam.lookAt(this.look);
      cam.updateMatrixWorld();
      this.material.uniforms.uEye.value.set(s.eye.x, s.eye.y, s.eye.z);
      // clear this slot to "far" so empty sky never hides anything
      renderer.setViewport(i * SIZE, 0, SIZE, HEIGHT);
      renderer.setScissor(i * SIZE, 0, SIZE, HEIGHT);
      renderer.setScissorTest(true);
      renderer.setClearColor(0xffffff, 1);
      renderer.clearColor();
      renderer.setClearColor(0x000000, 1);
      renderer.render(this.scene, cam);
      renderer.setScissorTest(false);

      shared.uVEye.value[i].set(s.eye.x, s.eye.y, s.eye.z);
      shared.uVDir.value[i].set(dx, dz);
      shared.uVCos.value[i] = Math.cos(s.halfAngle);
      shared.uVRange.value[i] = s.range;
      this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      shared.uVMat.value[i].copy(this.vp);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(this.prevClear, prevAlpha);
  }
}
