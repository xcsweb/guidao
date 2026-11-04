import * as THREE from 'three';
import type { Quality } from '@/state/store';
import type { LineGeometry, PathSample } from './LineGeometry';
import type { SimTrain } from '@/sim/Timetable';

export interface TrainPose {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  grade: number;
  speedKph: number;
}

export class TrainLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly windows: THREE.InstancedMesh;
  readonly headlight: THREE.InstancedMesh;
  readonly taillight: THREE.InstancedMesh;
  readonly bogies: THREE.InstancedMesh;
  readonly points: THREE.Points;
  readonly group = new THREE.Group();
  private maxDistance = 26000;
  private capacity = 640;
  private visibleCount = 0;
  private tempSample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private tempSample2: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private overview = false;
  private matrix = new THREE.Matrix4();
  private basis = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3(1, 1, 1);
  private color = new THREE.Color();

  constructor() {
    const geo = new THREE.BoxGeometry(2.9, 3.3, 46);
    geo.translate(0, 1.65, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    const windowGeo = new THREE.BoxGeometry(2.96, 0.82, 36);
    windowGeo.translate(0, 2.62, 0);
    const windowMat = new THREE.MeshLambertMaterial({ color: 0x0c141b });
    this.windows = new THREE.InstancedMesh(windowGeo, windowMat, this.capacity);
    this.windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.windows.frustumCulled = false;
    this.windows.count = 0;
    this.group.add(this.windows);

    const headGeo = new THREE.BoxGeometry(1.9, 0.15, 0.1);
    headGeo.translate(0, 2.45, 23.02);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false });
    this.headlight = new THREE.InstancedMesh(headGeo, headMat, this.capacity);
    this.headlight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.headlight.frustumCulled = false;
    this.headlight.count = 0;
    this.group.add(this.headlight);

    const tailGeo = new THREE.BoxGeometry(1.4, 0.14, 0.1);
    tailGeo.translate(0, 2.45, -23.02);
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff5c50, toneMapped: false });
    this.taillight = new THREE.InstancedMesh(tailGeo, tailMat, this.capacity);
    this.taillight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.taillight.frustumCulled = false;
    this.taillight.count = 0;
    this.group.add(this.taillight);

    const bogieGeo = new THREE.BoxGeometry(2.35, 0.58, 3.8);
    bogieGeo.translate(0, 0.29, 0);
    const bogieMat = new THREE.MeshLambertMaterial({ color: 0x232a30 });
    this.bogies = new THREE.InstancedMesh(bogieGeo, bogieMat, this.capacity * 2);
    this.bogies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bogies.frustumCulled = false;
    this.bogies.count = 0;
    this.group.add(this.bogies);

    const dotGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.capacity * 3);
    const colors = new Float32Array(this.capacity * 3);
    dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    dotGeo.setDrawRange(0, 0);
    const dotMat = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.points = new THREE.Points(dotGeo, dotMat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 30;
    this.group.add(this.points);
  }

  setOverviewMode(overview: boolean): void {
    this.overview = overview;
    this.points.visible = overview;
  }

  setQuality(quality: Quality): void {
    this.maxDistance = quality === 'low' ? 15000 : quality === 'medium' ? 26000 : 40000;
  }

  update(trains: SimTrain[], geometries: Map<string, LineGeometry>, camera: THREE.PerspectiveCamera): void {
    let count = 0;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const max2 = this.overview ? Infinity : this.maxDistance * this.maxDistance;

    for (const train of trains) {
      if (count >= this.capacity) break;
      const geo = geometries.get(train.lineId);
      if (!geo) continue;
      const s = train.direction === 0 ? train.distance : geo.length - train.distance;
      geo.sampleAt(s, this.tempSample);
      const x = this.tempSample.x;
      const z = this.tempSample.z;
      const dx = x - camX;
      const dz = z - camZ;
      if (dx * dx + dz * dz > max2) continue;

      let tx = this.tempSample.tx;
      let tz = this.tempSample.tz;
      if (train.direction === 1) {
        tx = -tx;
        tz = -tz;
      }
      const ahead = s + (train.direction === 0 ? 12 : -12);
      geo.sampleAt(ahead, this.tempSample2);
      const grade = (this.tempSample2.y - this.tempSample.y) / 12;

      this.forward.set(tx, grade, tz).normalize();
      this.up.set(0, 1, 0);
      this.right.crossVectors(this.up, this.forward).normalize();
      this.up.crossVectors(this.forward, this.right).normalize();
      this.basis.makeBasis(this.right, this.up, this.forward);
      this.quat.setFromRotationMatrix(this.basis);

      this.pos.set(x, this.tempSample.y + 0.6, z);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(count, this.matrix);
      this.windows.setMatrixAt(count, this.matrix);
      this.headlight.setMatrixAt(count, this.matrix);
      this.taillight.setMatrixAt(count, this.matrix);
      this.color.set(train.color);
      this.mesh.setColorAt(count, this.color);

      const bogieBase = count * 2;
      const bogieY = this.tempSample.y + 0.08;
      for (let bi = 0; bi < 2; bi++) {
        const offset = bi === 0 ? -15 : 15;
        this.pos.set(
          x + tx * offset,
          bogieY + grade * offset,
          z + tz * offset,
        );
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.bogies.setMatrixAt(bogieBase + bi, this.matrix);
      }

      this.matrix.compose(
        this.pos.set(x, this.tempSample.y + 40, z),
        IDENTITY_QUAT,
        this.scale,
      );
      const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
      posAttr.setXYZ(count, x, this.tempSample.y + 40, z);
      const c = this.color;
      colorAttr.setXYZ(count, c.r, c.g, c.b);
      count++;
    }

    this.mesh.count = count;
    this.windows.count = count;
    this.headlight.count = count;
    this.taillight.count = count;
    this.bogies.count = count * 2;
    this.visibleCount = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.windows.instanceMatrix.needsUpdate = true;
    this.headlight.instanceMatrix.needsUpdate = true;
    this.taillight.instanceMatrix.needsUpdate = true;
    this.bogies.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.points.geometry.setDrawRange(0, count);
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  getCount(): number {
    return this.visibleCount;
  }

  poseOf(train: SimTrain, geometries: Map<string, LineGeometry>): TrainPose | null {
    const geo = geometries.get(train.lineId);
    if (!geo) return null;
    const s = train.direction === 0 ? train.distance : geo.length - train.distance;
    geo.sampleAt(s, this.tempSample);
    let tx = this.tempSample.tx;
    let tz = this.tempSample.tz;
    if (train.direction === 1) {
      tx = -tx;
      tz = -tz;
    }
    const aheadS = s + (train.direction === 0 ? 10 : -10);
    geo.sampleAt(aheadS, this.tempSample2);
    const grade = (this.tempSample2.y - this.tempSample.y) / 10;
    return {
      x: this.tempSample.x,
      y: this.tempSample.y,
      z: this.tempSample.z,
      tx,
      tz,
      grade,
      speedKph: train.speedKph,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.windows.geometry.dispose();
    (this.windows.material as THREE.Material).dispose();
    this.windows.dispose();
    this.headlight.geometry.dispose();
    (this.headlight.material as THREE.Material).dispose();
    this.headlight.dispose();
    this.taillight.geometry.dispose();
    (this.taillight.material as THREE.Material).dispose();
    this.taillight.dispose();
    this.bogies.geometry.dispose();
    (this.bogies.material as THREE.Material).dispose();
    this.bogies.dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.dispose();
  }
}

const IDENTITY_QUAT = new THREE.Quaternion();
