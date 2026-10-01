import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { damp, easeInOutCubic, lerp } from '../core/tween';
import type { Glider } from '../player/glider';
import type { TerrainField } from '../world/terrainField';

export interface Pose {
  pos: Vector3;
  quat: Quaternion;
  fov: number;
}

const UP = new Vector3(0, 1, 0);
const NORTH_UP = new Vector3(0, 0, -1);
const Z_AXIS = new Vector3(0, 0, 1);
const tmpM = new Matrix4();
const tmpQ = new Quaternion();

function lookQuat(eye: Vector3, target: Vector3, up: Vector3, out: Quaternion): Quaternion {
  tmpM.lookAt(eye, target, up);
  return out.setFromRotationMatrix(tmpM);
}

/** Pose looking straight down with north at the top of the screen. */
export function topDownPose(x: number, z: number, height: number, fov: number): Pose {
  const pos = new Vector3(x, height, z);
  const quat = lookQuat(pos, new Vector3(x, 0, z), NORTH_UP, new Quaternion());
  return { pos, quat, fov };
}

/**
 * Drives the camera between poses. The target pose is recomputed every frame
 * (so it can follow the glider) and blended from a snapshot with an eased curve.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private readonly from: Pose = { pos: new Vector3(), quat: new Quaternion(), fov: 60 };
  private blendT = 1;
  private blendDur = 1;
  private readonly chasePos = new Vector3();
  private chaseInit = false;
  private shake = 0;
  /** Extra field of view that springs back (gate boost). */
  private kickFov = 0;
  /** Short shake that dies away (near miss). */
  private jolt = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(60, aspect, 0.5, 6000);
  }

  /** Start blending from the current camera pose to whatever target comes next. */
  blend(duration: number): void {
    this.from.pos.copy(this.camera.position);
    this.from.quat.copy(this.camera.quaternion);
    this.from.fov = this.camera.fov;
    this.blendT = 0;
    this.blendDur = duration;
  }

  get blending(): boolean {
    return this.blendT < 1;
  }

  get blendProgress(): number {
    return easeInOutCubic(Math.min(this.blendT, 1));
  }

  resetChase(): void {
    this.chaseInit = false;
  }

  setShake(amount: number): void {
    this.shake = amount;
  }

  /** Widen the view for a moment. */
  kick(degrees: number): void {
    this.kickFov = Math.max(this.kickFov, degrees);
  }

  /** A short shake on top of the steady one. */
  impulse(amount: number): void {
    this.jolt = Math.max(this.jolt, amount);
  }

  /** Third-person chase pose behind the glider. */
  chasePose(g: Glider, field: TerrainField, dt: number, out: Pose): Pose {
    const fx = Math.sin(g.yaw);
    const fz = -Math.cos(g.yaw);
    const desired = new Vector3(g.x - fx * 15, g.y + 5.4 - g.pitch * 5, g.z - fz * 15);
    if (!this.chaseInit) {
      this.chasePos.copy(desired);
      this.chaseInit = true;
    } else {
      this.chasePos.lerp(desired, damp(7, dt));
    }
    const ground = field.heightAt(this.chasePos.x, this.chasePos.z) + 2.5;
    if (this.chasePos.y < ground) this.chasePos.y = ground;

    out.pos.copy(this.chasePos);
    this.kickFov *= Math.exp(-3.5 * dt);
    this.jolt *= Math.exp(-6 * dt);
    const shake = this.shake + this.jolt;
    if (shake > 0) {
      out.pos.x += (Math.random() - 0.5) * shake;
      out.pos.y += (Math.random() - 0.5) * shake;
    }
    const cp = Math.cos(g.pitch);
    const target = new Vector3(g.x + fx * cp * 26, g.y + Math.sin(g.pitch) * 26 + 2.2, g.z + fz * cp * 26);
    lookQuat(out.pos, target, UP, out.quat);
    out.quat.multiply(tmpQ.setFromAxisAngle(Z_AXIS, -g.bank * 0.45));
    out.fov = 60 + Math.min(Math.max((g.speed - 40) * 0.24, 0), 20) + this.kickFov;
    return out;
  }

  /** Orbit-ish pose that looks at a point from a given offset. */
  lookPose(eye: Vector3, target: Vector3, fov: number, out: Pose): Pose {
    out.pos.copy(eye);
    lookQuat(eye, target, UP, out.quat);
    out.fov = fov;
    return out;
  }

  apply(target: Pose, dt: number): void {
    const cam = this.camera;
    if (this.blendT < 1) {
      this.blendT = Math.min(this.blendT + dt / this.blendDur, 1);
      const t = easeInOutCubic(this.blendT);
      cam.position.lerpVectors(this.from.pos, target.pos, t);
      cam.quaternion.slerpQuaternions(this.from.quat, target.quat, t);
      cam.fov = lerp(this.from.fov, target.fov, t);
    } else {
      cam.position.copy(target.pos);
      cam.quaternion.copy(target.quat);
      cam.fov = target.fov;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
