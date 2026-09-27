import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../core/tween';
import type { HeightField } from '../field/heightfield';

/** Over-the-shoulder camera driven by mouse look, kept above the ground. */
export class FollowCam {
  readonly camera = new PerspectiveCamera(58, 1, 0.3, 1200);
  yaw = 0;
  pitch = 0.32;
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private init = false;
  distance = 8.5;

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  look(dx: number, dy: number): void {
    this.yaw += dx * 0.0035;
    this.pitch = Math.min(Math.max(this.pitch + dy * 0.0025, -0.05), 1.1);
  }

  snap(): void {
    this.init = false;
  }

  /** Direction the camera faces on the ground plane: [x, z]. */
  get forward(): [number, number] {
    return [Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  update(px: number, py: number, pz: number, field: HeightField, dt: number): void {
    const [fx, fz] = this.forward;
    const cp = Math.cos(this.pitch);
    const want = new Vector3(px - fx * this.distance * cp, py + 2.2 + Math.sin(this.pitch) * this.distance, pz - fz * this.distance * cp);
    const ground = field.heightAt(want.x, want.z) + 1.2;
    if (want.y < ground) want.y = ground;
    if (!this.init) {
      this.pos.copy(want);
      this.init = true;
    } else this.pos.lerp(want, damp(10, dt));
    this.target.set(px + fx * 3, py + 1.6, pz + fz * 3);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
