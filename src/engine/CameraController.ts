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
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.9;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 180000;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = false;

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
    this.flying = { from, to, t: 0, duration };
    this.controls.enabled = false;
  }

  flyToStation(x: number, z: number, y: number): void {
    const target = new THREE.Vector3(x, y * this.exaggeration, z);
    const dir = new THREE.Vector3(this.camera.position.x - x, 0, this.camera.position.z - z);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    const distance = 2600;
    const to = {
      position: new THREE.Vector3(
        x + dir.x * distance,
        Math.max(this.camera.position.y, target.y + 1500),
        z + dir.z * distance,
      ),
      target,
    };
    this.flying = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      t: 0,
      duration: 1.1,
    };
    this.controls.enabled = false;
  }

  resetView(): void {
    this.flying = {
      from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
      to: { position: this.initial.position.clone(), target: this.initial.target.clone() },
      t: 0,
      duration: 1.1,
    };
    this.mode = 'orbit';
    this.controls.enabled = false;
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
      this.followBlend = Math.min(1, this.followBlend + dt / 1.15);
      const forward = new THREE.Vector3(pose.tx, pose.grade, pose.tz).normalize();
      const behind = this.tunnel ? 29 : 26;
      const camHeight = this.tunnel ? 4.15 : 6.0;
      const lookAhead = 150;
      const lookUp = this.tunnel ? 2.1 : 2.5;
      const desiredPos = new THREE.Vector3(
        pose.x + forward.x * behind,
        pose.y * this.exaggeration + camHeight,
        pose.z + forward.z * behind,
      );
      if (!this.tunnel) {
        const ground = this.terrain.heightAt(desiredPos.x, desiredPos.z) * this.exaggeration;
        desiredPos.y = Math.max(desiredPos.y, ground + 2.5);
      } else {
        desiredPos.y = pose.y * this.exaggeration + camHeight;
      }
      const desiredLook = new THREE.Vector3(
        pose.x + forward.x * lookAhead,
        pose.y * this.exaggeration + forward.y * lookAhead + lookUp,
        pose.z + forward.z * lookAhead,
      );
      const k = 1 - Math.exp(-dt * (this.followBlend < 0.6 ? 5 : 9));
      this.camera.position.lerp(desiredPos, k);
      this.lookAtTarget.lerp(desiredLook, k);
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
    const target = this.mode === 'follow' && this.tunnel ? 66 : 55;
    const diff = target - this.camera.fov;
    if (Math.abs(diff) < 0.04) return;
    this.camera.fov += diff * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
