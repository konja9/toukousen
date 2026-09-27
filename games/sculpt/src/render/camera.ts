import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../core/tween';

/**
 * Orbit camera around the model. Azimuth snaps in 90° steps (Q/E) and the
 * elevation switches between an oblique view and a near-plan view (V).
 */
export class OrbitRig {
  readonly camera = new PerspectiveCamera(34, 1, 1, 2000);
  azimuth = Math.PI * 0.25;
  targetAzimuth = Math.PI * 0.25;
  elevation = 0.95;
  targetElevation = 0.95;
  distance = 130;
  targetDistance = 130;
  readonly focus = new Vector3(0, 6, 0);
  readonly targetFocus = new Vector3(0, 6, 0);
  plan = false;
  /** 0..1: slide the model right to make room for text (title screen). */
  shift = 0;
  targetShift = 0;
  private aspect = 1;
  private pxW = 1;
  private pxH = 1;

  static readonly OBLIQUE = 0.92;
  static readonly PLAN = 1.53;

  resize(aspect: number, w = 1, h = 1): void {
    this.pxW = w;
    this.pxH = h;
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.targetDistance = this.fitDistance();
  }

  /** Distance that fits the 80 m model (with margin) in view. */
  private fitDistance(): number {
    const vfov = (this.camera.fov * Math.PI) / 180;
    // half extent incl. walls and margin; a rotated square seen from above needs its diagonal
    const need = this.plan ? 60 : 54;
    const byH = need / Math.tan(vfov / 2);
    const byW = need / (Math.tan(vfov / 2) * Math.min(this.aspect, 1.6));
    return Math.max(byH, byW) * (1.05 + 0.25 * this.targetShift);
  }

  rotate(dir: 1 | -1): void {
    this.targetAzimuth += (dir * Math.PI) / 2;
  }

  togglePlan(): void {
    this.plan = !this.plan;
    this.targetElevation = this.plan ? OrbitRig.PLAN : OrbitRig.OBLIQUE;
    this.targetDistance = this.fitDistance();
  }

  update(dt: number): void {
    const k = damp(5, dt);
    this.azimuth += (this.targetAzimuth - this.azimuth) * k;
    this.elevation += (this.targetElevation - this.elevation) * k;
    this.distance += (this.targetDistance - this.distance) * k;
    this.focus.lerp(this.targetFocus, damp(3, dt));
    this.shift += (this.targetShift - this.shift) * damp(4, dt);
    if (Math.abs(this.shift) > 1e-3) this.camera.setViewOffset(this.pxW, this.pxH, -this.pxW * 0.09 * this.shift, 0, this.pxW, this.pxH);
    else this.camera.clearViewOffset();
    this.targetDistance = this.fitDistance();
    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      this.focus.x + Math.sin(this.azimuth) * ce * this.distance,
      this.focus.y + Math.sin(this.elevation) * this.distance,
      this.focus.z + Math.cos(this.azimuth) * ce * this.distance,
    );
    // elevation stays below 90°, so world-up is always a valid up vector
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }
}
