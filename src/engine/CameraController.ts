import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TerrainSystem } from './Terrain';
import type { TrainPose } from './TrainLayer';

type Mode = 'orbit' | 'follow';

interface OrbitState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private terrain: TerrainSystem;
  private exaggeration = 1;
  private mode: Mode = 'orbit';
  private saved: OrbitState | null = null;
  private followPose: TrainPose | null = null;
  private followBlend = 0;
  private restoring: { from: OrbitState; to: OrbitState; t: number } | null = null;
  private flying: { from: OrbitState; to: OrbitState; t: number; duration: number } | null = null;
  private lookAtTarget = new THREE.Vector3();
  private tunnel = false;
  private initial: OrbitState;
  private center: [number, number];

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    terrain: TerrainSystem,
    center: [number, number],
    span: number,
  ) {
    this.camera = camera;
    this.terrain = terrain;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 1.05;
    this.controls.panSpeed = 1;
    this.controls.minDistance = 45;
    this.controls.maxDistance = 180000;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    const height = Math.min(30000, Math.max(5000, span * 0.045));
    const distance = height * 0.85;
    const position = new THREE.Vector3(
      center[0] - distance * 0.72,
      height,
      center[1] + distance * 0.5,
    );
    const target = new THREE.Vector3(center[0], terrain.heightAt(center[0], center[1]) + 40, center[1]);
    camera.position.copy(position);
    this.lookAtTarget.copy(target);
    camera.lookAt(target);
    this.controls.target.copy(target);
    this.controls.update();
    this.initial = { position: position.clone(), target: target.clone() };
    this.center = center;
  }

  get isFollowing(): boolean {
    return this.mode === 'follow';
  }

  get followingPose(): TrainPose | null {
    return this.followPose;
  }

  updateFollowPose(pose: TrainPose, isTunnel: boolean): void {
    this.followPose = pose;
    this.tunnel = isTunnel;
  }

  setExaggeration(value: number): void {
    const old = this.exaggeration;
    this.exaggeration = value;
    const ratio = value / old;
    this.camera.position.y *= ratio;
    this.controls.target.y *= ratio;
    if (this.followPose) {
      this.followPose = { ...this.followPose, y: this.followPose.y * ratio };
    }
  }

  enterFollow(): void {
    if (this.mode === 'follow') return;
    this.saved = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    this.mode = 'follow';
    this.followBlend = 0;
    this.controls.enabled = false;
    this.flying = null;
    this.restoring = null;
  }

  exitFollow(): void {
    if (this.mode !== 'follow') return;
    this.mode = 'orbit';
    this.followPose = null;
    if (this.saved) {
      this.restoring = {
        from: { position: this.camera.position.clone(), target: this.lookAtTarget.clone() },
        to: this.saved,
        t: 0,
      };
    }
    this.saved = null;
  }

  flyTo(center: [number, number], bounds: [number, number, number, number], duration = 1.2): void {
    const width = bounds[2] - bounds[0];
    const depth = bounds[3] - bounds[1];
    const span = Math.max(width, depth);
    const distance = Math.max(2200, span * 0.6);
    const height = this.terrain.heightAt(center[0], center[1]) * this.exaggeration + 60;
    const azimuth = Math.atan2(this.camera.position.z - center[1], this.camera.position.x - center[0]);
    const target = new THREE.Vector3(center[0], height, center[1]);
    const from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const to = {
      position: new THREE.Vector3(
        center[0] + Math.cos(azimuth) * distance,
        height + distance * 0.55,
        center[1] + Math.sin(azimuth) * distance,
      ),
      target,
    };
    this.mode = 'orbit';
    this.followPose = null;
    this.saved = null;
    this.restoring = null;
    this.flying = { from, to, t: 0, duration };
    this.controls.enabled = false;
  }

  flyToStation(x: number, z: number, y: number): void {
    const target = new THREE.Vector3(x, y * this.exaggeration, z);
    const dir = new THREE.Vector3(this.camera.position.x - x, 0, this.camera.position.z - z);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    const distance = 760;
    const to = {
      position: new THREE.Vector3(
        x + dir.x * distance,
        target.y + 520,
        z + dir.z * distance,
      ),
      target,
    };
    this.restoring = null;
    this.followPose = null;
    this.saved = null;
    this.flying = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      t: 0,
      duration: 1.1,
    };
    this.controls.enabled = false;
  }

  resetView(): void {
    this.restoring = null;
    this.followPose = null;
    this.saved = null;
    this.flying = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to: { position: this.initial.position.clone(), target: this.initial.target.clone() },
      t: 0,
      duration: 1.1,
    };
    this.mode = 'orbit';
    this.controls.enabled = false;
  }

  zoomBy(factor: number): void {
    if (this.mode === 'follow') return;
    this.flying = null;
    this.restoring = null;
    this.controls.enabled = true;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    offset.setLength(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  update(dt: number): void {
    this.updateFov(dt);

    if (this.flying) {
      this.flying.t += dt / this.flying.duration;
      const t = easeInOut(Math.min(1, this.flying.t));
      this.camera.position.lerpVectors(this.flying.from.position, this.flying.to.position, t);
      this.lookAtTarget.lerpVectors(this.flying.from.target, this.flying.to.target, t);
      this.controls.target.copy(this.lookAtTarget);
      this.camera.lookAt(this.lookAtTarget);
      if (this.flying.t >= 1) {
        this.flying = null;
        this.controls.enabled = true;
        this.controls.update();
      }
      return;
    }

    if (this.restoring) {
      this.restoring.t += dt / 1.1;
      const t = easeInOut(Math.min(1, this.restoring.t));
      this.camera.position.lerpVectors(this.restoring.from.position, this.restoring.to.position, t);
      this.lookAtTarget.lerpVectors(this.restoring.from.target, this.restoring.to.target, t);
      this.controls.target.copy(this.lookAtTarget);
      this.camera.lookAt(this.lookAtTarget);
      if (this.restoring.t >= 1) {
        this.restoring = null;
        this.controls.enabled = true;
        this.controls.update();
      }
      return;
    }

    if (this.mode === 'follow') {
      const pose = this.followPose;
      if (!pose) return;
      this.followBlend = Math.min(1, this.followBlend + dt / 0.85);
      const eyeHeight = this.tunnel ? 2.5 : 2.7;
      const desiredPos = new THREE.Vector3(
        pose.x,
        pose.y * this.exaggeration + eyeHeight,
        pose.z,
      );
      const desiredLook = new THREE.Vector3(
        pose.lookX,
        pose.lookY * this.exaggeration + 2.35,
        pose.lookZ,
      );
      if (desiredLook.distanceToSquared(desiredPos) < 4) {
        desiredLook.set(
          pose.x + pose.tx * 40,
          desiredPos.y + pose.grade * 40,
          pose.z + pose.tz * 40,
        );
      }
      if (this.followBlend < 1) {
        const k = 1 - Math.exp(-dt * 7);
        this.camera.position.lerp(desiredPos, k);
        this.lookAtTarget.lerp(desiredLook, k);
      } else {
        // Stay exactly on the track after the transition; smoothing the position
        // itself creates a chord through tunnel walls on tight curves.
        this.camera.position.copy(desiredPos);
        this.lookAtTarget.copy(desiredLook);
      }
      this.controls.target.copy(this.lookAtTarget);
      this.camera.lookAt(this.lookAtTarget);
      return;
    }

    this.controls.enabled = true;
    this.controls.update();
    const ground =
      Math.max(
        this.terrain.heightAt(this.camera.position.x, this.camera.position.z),
        this.terrain.heightAt(this.camera.position.x + 40, this.camera.position.z),
        this.terrain.heightAt(this.camera.position.x - 40, this.camera.position.z),
        this.terrain.heightAt(this.camera.position.x, this.camera.position.z + 40),
        this.terrain.heightAt(this.camera.position.x, this.camera.position.z - 40),
      ) * this.exaggeration;
    if (this.camera.position.y < ground + 30) {
      this.camera.position.y = ground + 30;
    }
    this.lookAtTarget.copy(this.controls.target);
  }

  dispose(): void {
    this.controls.dispose();
  }

  private updateFov(dt: number): void {
    const target = this.mode === 'follow' ? (this.tunnel ? 64 : 58) : 55;
    const diff = target - this.camera.fov;
    if (Math.abs(diff) < 0.04) return;
    this.camera.fov += diff * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
