import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '@/state/store';
import type { LineGeometry, PathSample } from './LineGeometry';
import type { SimTrain } from '@/sim/Timetable';

const CAR_OFFSETS = [-15, 0, 15] as const;
const CAR_LENGTH = 13.6;
const BODY_BOTTOM = 0.56;
const RAIL_TOP = 0.02;
const LANE_OFFSET = 1.58;

export interface TrainPose {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  grade: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  speedKph: number;
}

export class TrainLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly windows: THREE.InstancedMesh;
  readonly headlight: THREE.InstancedMesh;
  readonly taillight: THREE.InstancedMesh;
  readonly bogies: THREE.InstancedMesh;
  readonly roofUnits: THREE.InstancedMesh;
  readonly pantographs: THREE.InstancedMesh;
  readonly doors: THREE.InstancedMesh;
  readonly points: THREE.Points;
  readonly group = new THREE.Group();
  private maxDistance = 26000;
  private capacity = 640;
  private visibleCount = 0;
  private followedId: string | null = null;
  private localOnly = false;
  private tempSample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private tempSample2: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private carSample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private carSample2: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
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
    const geo = new RoundedBoxGeometry(2.9, 3.15, CAR_LENGTH, 1, 0.14);
    geo.translate(0, 1.575, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity * CAR_OFFSETS.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    const windowGeo = new RoundedBoxGeometry(2.94, 0.78, CAR_LENGTH - 2.3, 1, 0.08);
    windowGeo.translate(0, 2.42, 0);
    const windowMat = new THREE.MeshLambertMaterial({ color: 0x101c25 });
    this.windows = new THREE.InstancedMesh(
      windowGeo,
      windowMat,
      this.capacity * CAR_OFFSETS.length,
    );
    this.windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.windows.frustumCulled = false;
    this.windows.count = 0;
    this.group.add(this.windows);

    const headGeo = new THREE.BoxGeometry(1.9, 0.15, 0.1);
    headGeo.translate(0, 2.35, CAR_LENGTH / 2 + 0.03);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false });
    this.headlight = new THREE.InstancedMesh(headGeo, headMat, this.capacity);
    this.headlight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.headlight.frustumCulled = false;
    this.headlight.count = 0;
    this.group.add(this.headlight);

    const tailGeo = new THREE.BoxGeometry(1.4, 0.14, 0.1);
    tailGeo.translate(0, 2.35, -CAR_LENGTH / 2 - 0.03);
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff5c50, toneMapped: false });
    this.taillight = new THREE.InstancedMesh(tailGeo, tailMat, this.capacity);
    this.taillight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.taillight.frustumCulled = false;
    this.taillight.count = 0;
    this.group.add(this.taillight);

    const bogieGeo = new THREE.BoxGeometry(2.35, 0.68, 2.8);
    bogieGeo.translate(0, 0.34, 0);
    const bogieMat = new THREE.MeshLambertMaterial({ color: 0x232a30 });
    this.bogies = new THREE.InstancedMesh(
      bogieGeo,
      bogieMat,
      this.capacity * CAR_OFFSETS.length * 2,
    );
    this.bogies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bogies.frustumCulled = false;
    this.bogies.count = 0;
    this.group.add(this.bogies);

    // Roof equipment and pantograph break up the long, otherwise plain car body.
    const roofGeo = new RoundedBoxGeometry(1.55, 0.3, 3.1, 1, 0.06);
    roofGeo.translate(0, 3.29, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xa7b0b6 });
    this.roofUnits = new THREE.InstancedMesh(
      roofGeo,
      roofMat,
      this.capacity * CAR_OFFSETS.length * 2,
    );
    this.roofUnits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.roofUnits.frustumCulled = false;
    this.roofUnits.count = 0;
    this.group.add(this.roofUnits);

    const pantoMat = new THREE.MeshLambertMaterial({ color: 0x5d666d });
    this.pantographs = new THREE.InstancedMesh(
      buildPantographGeometry(),
      pantoMat,
      this.capacity,
    );
    this.pantographs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pantographs.frustumCulled = false;
    this.pantographs.count = 0;
    this.group.add(this.pantographs);

    // Recessed door seams: two per car side, four pairs along the body.
    const doorGeo = new THREE.BoxGeometry(0.06, 2.35, 0.14);
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x39474f });
    this.doors = new THREE.InstancedMesh(
      doorGeo,
      doorMat,
      this.capacity * CAR_OFFSETS.length * 8,
    );
    this.doors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.doors.frustumCulled = false;
    this.doors.count = 0;
    this.group.add(this.doors);

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
    this.mesh.visible = !overview;
    this.windows.visible = !overview;
    this.headlight.visible = !overview;
    this.taillight.visible = !overview;
    this.bogies.visible = !overview;
    this.roofUnits.visible = !overview;
    this.pantographs.visible = !overview;
    this.doors.visible = !overview;
  }

  setFollowedTrain(id: string | null): void {
    this.followedId = id;
  }

  setLocalOnly(localOnly: boolean): void {
    this.localOnly = localOnly;
  }

  setQuality(quality: Quality): void {
    this.maxDistance = quality === 'low' ? 15000 : quality === 'medium' ? 26000 : 40000;
  }

  update(trains: SimTrain[], geometries: Map<string, LineGeometry>, camera: THREE.PerspectiveCamera): void {
    let trainCount = 0;
    let carCount = 0;
    let bogieCount = 0;
    let roofCount = 0;
    let doorCount = 0;
    let pantoCount = 0;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const maxDistance = this.localOnly && !this.overview ? 1000 : this.maxDistance;
    const max2 = this.overview ? Infinity : maxDistance * maxDistance;
    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;

    for (const train of trains) {
      if (trainCount >= this.capacity) break;
      if (train.id === this.followedId && !this.overview) continue;
      const geo = geometries.get(train.lineId);
      if (!geo) continue;
      const direction = train.direction === 0 ? 1 : -1;
      const s = train.direction === 0 ? train.distance : geo.length - train.distance;
      geo.sampleAt(s, this.tempSample);
      const centerLaneX = -this.tempSample.tz * direction * LANE_OFFSET;
      const centerLaneZ = this.tempSample.tx * direction * LANE_OFFSET;
      const centerX = this.tempSample.x + centerLaneX;
      const centerY = this.tempSample.y;
      const centerZ = this.tempSample.z + centerLaneZ;
      const dx = centerX - camX;
      const dz = centerZ - camZ;
      if (dx * dx + dz * dz > max2) continue;

      this.color.set(train.color);
      for (let ci = 0; !this.overview && ci < CAR_OFFSETS.length; ci++) {
        const offset = CAR_OFFSETS[ci];
        const carS = s + direction * offset;
        geo.sampleAt(carS, this.carSample);
        const tx = this.carSample.tx * direction;
        const tz = this.carSample.tz * direction;
        const laneX = -this.carSample.tz * direction * LANE_OFFSET;
        const laneZ = this.carSample.tx * direction * LANE_OFFSET;
        geo.sampleAt(carS + direction * 6, this.carSample2);
        const grade = (this.carSample2.y - this.carSample.y) / 6;

        this.forward.set(tx, grade, tz).normalize();
        this.up.set(0, 1, 0);
        this.right.crossVectors(this.up, this.forward).normalize();
        this.up.crossVectors(this.forward, this.right).normalize();
        this.basis.makeBasis(this.right, this.up, this.forward);
        this.quat.setFromRotationMatrix(this.basis);

        this.pos.set(
          this.carSample.x + laneX,
          this.carSample.y + BODY_BOTTOM,
          this.carSample.z + laneZ,
        );
        this.matrix.compose(this.pos, this.quat, this.scale);
        this.mesh.setMatrixAt(carCount, this.matrix);
        this.windows.setMatrixAt(carCount, this.matrix);
        this.mesh.setColorAt(carCount, this.color);
        if (ci === CAR_OFFSETS.length - 1) this.headlight.setMatrixAt(trainCount, this.matrix);
        if (ci === 0) this.taillight.setMatrixAt(trainCount, this.matrix);

        const baseX = this.pos.x;
        const baseY = this.pos.y;
        const baseZ = this.pos.z;
        const rx = this.right.x;
        const ry = this.right.y;
        const rz = this.right.z;
        const ux = this.up.x;
        const uy = this.up.y;
        const uz = this.up.z;
        const fx = this.forward.x;
        const fy = this.forward.y;
        const fz = this.forward.z;

        for (const dz of [-3.5, 3.5]) {
          this.pos.set(baseX + fx * dz, baseY + fy * dz, baseZ + fz * dz);
          this.matrix.compose(this.pos, this.quat, this.scale);
          this.roofUnits.setMatrixAt(roofCount++, this.matrix);
        }

        this.pos.set(baseX + ux * 3.13 + fx * 1.4, baseY + uy * 3.13 + fy * 1.4, baseZ + uz * 3.13 + fz * 1.4);
        this.matrix.compose(this.pos, this.quat, this.scale);
        if (ci === 1) this.pantographs.setMatrixAt(pantoCount++, this.matrix);

        for (const dx of [-1.455, 1.455]) {
          for (const dz of [-5.05, -1.85, 1.85, 5.05]) {
            this.pos.set(
              baseX + rx * dx + ux * 1.52 + fx * dz,
              baseY + ry * dx + uy * 1.52 + fy * dz,
              baseZ + rz * dx + uz * 1.52 + fz * dz,
            );
            this.matrix.compose(this.pos, this.quat, this.scale);
            this.doors.setMatrixAt(doorCount++, this.matrix);
          }
        }

        for (const bogieOffset of [-4.25, 4.25]) {
          this.pos.set(
            this.carSample.x + laneX + tx * bogieOffset,
            this.carSample.y + RAIL_TOP + grade * bogieOffset,
            this.carSample.z + laneZ + tz * bogieOffset,
          );
          this.matrix.compose(this.pos, this.quat, this.scale);
          this.bogies.setMatrixAt(bogieCount++, this.matrix);
        }
        carCount++;
      }

      posAttr.setXYZ(trainCount, centerX, centerY + 40, centerZ);
      colorAttr.setXYZ(trainCount, this.color.r, this.color.g, this.color.b);
      trainCount++;
    }

    this.mesh.count = carCount;
    this.windows.count = carCount;
    this.headlight.count = trainCount;
    this.taillight.count = trainCount;
    this.bogies.count = bogieCount;
    this.roofUnits.count = roofCount;
    this.pantographs.count = pantoCount;
    this.doors.count = doorCount;
    this.visibleCount = trainCount;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.windows.instanceMatrix.needsUpdate = true;
    this.headlight.instanceMatrix.needsUpdate = true;
    this.taillight.instanceMatrix.needsUpdate = true;
    this.bogies.instanceMatrix.needsUpdate = true;
    this.roofUnits.instanceMatrix.needsUpdate = true;
    this.pantographs.instanceMatrix.needsUpdate = true;
    this.doors.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.points.geometry.setDrawRange(0, trainCount);
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  getCount(): number {
    return this.visibleCount;
  }

  poseOf(
    train: SimTrain,
    geometries: Map<string, LineGeometry>,
    cabOffset = 18.6,
  ): TrainPose | null {
    const geo = geometries.get(train.lineId);
    if (!geo) return null;
    const direction = train.direction === 0 ? 1 : -1;
    const centerS = train.direction === 0 ? train.distance : geo.length - train.distance;
    const s = centerS + direction * cabOffset;
    geo.sampleAt(s, this.tempSample);
    const tx = this.tempSample.tx * direction;
    const tz = this.tempSample.tz * direction;
    const laneX = -this.tempSample.tz * direction * LANE_OFFSET;
    const laneZ = this.tempSample.tx * direction * LANE_OFFSET;
    geo.sampleAt(s + direction * 6, this.tempSample2);
    const grade = (this.tempSample2.y - this.tempSample.y) / 6;
    geo.sampleAt(s + direction * 85, this.tempSample2);
    const lookLaneX = -this.tempSample2.tz * direction * LANE_OFFSET;
    const lookLaneZ = this.tempSample2.tx * direction * LANE_OFFSET;
    return {
      x: this.tempSample.x + laneX,
      y: this.tempSample.y,
      z: this.tempSample.z + laneZ,
      tx,
      tz,
      grade,
      lookX: this.tempSample2.x + lookLaneX,
      lookY: this.tempSample2.y,
      lookZ: this.tempSample2.z + lookLaneZ,
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
    this.roofUnits.geometry.dispose();
    (this.roofUnits.material as THREE.Material).dispose();
    this.roofUnits.dispose();
    this.pantographs.geometry.dispose();
    (this.pantographs.material as THREE.Material).dispose();
    this.pantographs.dispose();
    this.doors.geometry.dispose();
    (this.doors.material as THREE.Material).dispose();
    this.doors.dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.dispose();
  }
}

/** Folded diamond pantograph: base frame, two arms and a contact bar. */
function buildPantographGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(1.5, 0.09, 0.85);
  base.translate(0, 0.05, 0);
  const armA = new THREE.BoxGeometry(0.06, 0.98, 0.06);
  armA.rotateX(0.62);
  armA.translate(0, 0.52, 0.17);
  const armB = new THREE.BoxGeometry(0.06, 0.98, 0.06);
  armB.rotateX(-0.62);
  armB.translate(0, 0.52, -0.17);
  const bar = new THREE.BoxGeometry(1.35, 0.05, 0.1);
  bar.translate(0, 0.97, 0);
  const merged = mergeGeometries([base, armA, armB, bar], false);
  base.dispose();
  armA.dispose();
  armB.dispose();
  bar.dispose();
  return merged ?? new THREE.BoxGeometry(1.4, 0.1, 0.8);
}
