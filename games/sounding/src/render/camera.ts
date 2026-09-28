import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../core/tween';
import { floorAt } from '../field/grid';

/**
 * Chase camera behind and a little above the sub. Dragging the mouse swings
 * it around; let go and it drifts back behind the stern.
 */
export class ChaseCam {
  readonly camera = new PerspectiveCamera(60, 1, 0.5, 900);
  /** Offset from straight behind (radians), set by dragging. */
  yawOffset = 0;
  pitch = 0.42;
  distance = 30;
  dragging = false;
  shake = 0;
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private init = false;

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  look(dx: number, dy: number): void {
    this.yawOffset += dx * 0.005;
    this.pitch = Math.min(Math.max(this.pitch + dy * 0.003, -0.35), 1.2);
  }

  snap(): void {
    this.init = false;
  }

  update(x: number, y: number, z: number, heading: number, floor: Float32Array | null, dt: number, time: number): void {
    if (!this.dragging) {
      this.yawOffset += (Math.atan2(Math.sin(-this.yawOffset), Math.cos(-this.yawOffset))) * damp(1.2, dt);
      this.pitch += (0.42 - this.pitch) * damp(0.6, dt);
    }
    const yaw = heading + this.yawOffset;
    const fx = Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const cp = Math.cos(this.pitch);
    const want = new Vector3(x - fx * this.distance * cp, y + 2 + Math.sin(this.pitch) * this.distance, z - fz * this.distance * cp);
    if (floor) want.y = Math.max(want.y, floorAt(floor, want.x, want.z) + 3);
    want.y = Math.min(want.y, -2);
    if (!this.init) {
      this.pos.copy(want);
      this.init = true;
    } else this.pos.lerp(want, damp(4, dt));
    this.target.set(x + Math.sin(heading) * 16, y - 2, z - Math.cos(heading) * 16);
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      const s = this.shake;
      this.camera.position.x += Math.sin(time * 71) * s;
      this.camera.position.y += Math.sin(time * 53 + 1) * s;
      this.camera.position.z += Math.sin(time * 67 + 2) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
