import * as THREE from 'three';
import type { NetworkFile, StationData } from '@/data/types';
import type { LineGeometry, PathSample } from './LineGeometry';
import type { Quality } from '@/state/store';

interface StationModel {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: string;
  station: StationData;
  underground: boolean;
}

interface Ranked {
  model: StationModel;
  distance: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Surface stations have twin platforms and canopies; underground stations only
 * expose street-level entrances, stairs and vents. Every part is instanced and
 * only nearby stations keep matrices, so detail does not grow draw calls per station.
 */
export class StationDetailLayer {
  readonly group = new THREE.Group();

  private models: StationModel[] = [];
  private platformL: THREE.InstancedMesh;
  private platformR: THREE.InstancedMesh;
  private tactileL: THREE.InstancedMesh;
  private tactileR: THREE.InstancedMesh;
  private roof: THREE.InstancedMesh;
  private fasciaL: THREE.InstancedMesh;
  private fasciaR: THREE.InstancedMesh;
  private pillars: THREE.InstancedMesh;
  private hall: THREE.InstancedMesh;
  private band: THREE.InstancedMesh;
  private entrance: THREE.InstancedMesh;
  private metroBase: THREE.InstancedMesh;
  private metroHall: THREE.InstancedMesh;
  private metroOpening: THREE.InstancedMesh;
  private metroCap: THREE.InstancedMesh;
  private metroSteps: THREE.InstancedMesh;
  private metroVent: THREE.InstancedMesh;
  private totemPole: THREE.InstancedMesh;
  private totemSign: THREE.InstancedMesh;

  private capacity: number;
  private detailed = new Set<string>();
  private lastUpdate = 0;
  private lastKey = '';
  private quality: Quality = 'medium';

  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private color = new THREE.Color();

  private fullRadius = 1700;
  private mediumRadius = 6800;
  private fullCap = 28;
  private mediumCap = 110;
  private metricScale = 1;

  constructor(
    network: NetworkFile,
    geometries: Map<string, LineGeometry>,
    stationPositions: Map<string, { x: number; y: number; z: number; color: string }>,
    viewportHeight: number,
    fovDeg: number,
  ) {
    this.capacity = Math.max(1, network.stations.length);
    this.models = this.collectModels(network, geometries, stationPositions);

    const concrete = new THREE.MeshLambertMaterial({ color: 0xcbd2d5 });
    const concreteDark = new THREE.MeshLambertMaterial({ color: 0x9aa2a7 });
    const tactileMat = new THREE.MeshBasicMaterial({
      color: 0xeab63b,
      toneMapped: false,
    });
    const roofMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const accentMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x969ea3 });
    const metroGlassMat = new THREE.MeshLambertMaterial({
      color: 0xa7c3cc,
      emissive: 0x1a2c33,
    });
    const openingMat = new THREE.MeshBasicMaterial({ color: 0x10181d });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x6b7479 });

    const platformGeo = new THREE.BoxGeometry(3.5, 0.55, 92);
    this.platformL = this.instanced(platformGeo.clone(), concrete, this.capacity);
    this.platformL.geometry.translate(-5.15, 0.72, 0);
    this.platformR = this.instanced(platformGeo.clone(), concrete, this.capacity);
    this.platformR.geometry.translate(5.15, 0.72, 0);

    const tactileGeo = new THREE.BoxGeometry(0.36, 0.05, 88);
    this.tactileL = this.instanced(tactileGeo.clone(), tactileMat, this.capacity);
    this.tactileL.geometry.translate(-3.65, 1.035, 0);
    this.tactileR = this.instanced(tactileGeo.clone(), tactileMat, this.capacity);
    this.tactileR.geometry.translate(3.65, 1.035, 0);

    const roofGeo = buildArchRoofGeometry(15.6, 86, 4.55, 1.15, 8);
    this.roof = this.instanced(roofGeo, roofMat, this.capacity, true);

    const fasciaGeo = new THREE.BoxGeometry(0.16, 0.6, 86);
    this.fasciaL = this.instanced(fasciaGeo.clone(), accentMat, this.capacity, true);
    this.fasciaL.geometry.translate(-7.68, 4.82, 0);
    this.fasciaR = this.instanced(fasciaGeo.clone(), accentMat, this.capacity, true);
    this.fasciaR.geometry.translate(7.68, 4.82, 0);

    const pillarGeo = new THREE.BoxGeometry(0.28, 3.55, 0.28);
    pillarGeo.translate(0, 2.775, 0);
    this.pillars = this.instanced(pillarGeo, concreteDark, this.capacity * 12);

    const hallGeo = new THREE.BoxGeometry(13, 7.2, 16);
    hallGeo.translate(15.5, 3.6, 0);
    this.hall = this.instanced(hallGeo, hallMat, this.capacity);

    const bandGeo = new THREE.BoxGeometry(0.22, 0.55, 16.1);
    bandGeo.translate(22.08, 5.45, 0);
    this.band = this.instanced(bandGeo, accentMat, this.capacity, true);

    const entranceGeo = new THREE.BoxGeometry(3.1, 2.4, 3.2);
    entranceGeo.translate(23.2, 1.2, -9);
    this.entrance = this.instanced(entranceGeo, concreteDark, this.capacity);

    const metroBaseGeo = new THREE.BoxGeometry(8.4, 0.24, 7);
    metroBaseGeo.translate(9.6, 0.12, 0);
    this.metroBase = this.instanced(metroBaseGeo, concreteDark, this.capacity * 2);

    const metroHallGeo = new THREE.BoxGeometry(4.6, 3, 5.8);
    metroHallGeo.translate(11.1, 1.72, 0);
    this.metroHall = this.instanced(metroHallGeo, metroGlassMat, this.capacity * 2);

    const metroOpeningGeo = new THREE.BoxGeometry(0.14, 2.35, 3.6);
    metroOpeningGeo.translate(8.74, 1.35, 0);
    this.metroOpening = this.instanced(metroOpeningGeo, openingMat, this.capacity * 2);

    const metroCapGeo = new THREE.BoxGeometry(5.8, 0.26, 6.6);
    metroCapGeo.translate(10.9, 3.34, 0);
    this.metroCap = this.instanced(metroCapGeo, accentMat, this.capacity * 2, true);

    this.metroSteps = this.instanced(
      new THREE.BoxGeometry(0.68, 0.14, 3.4),
      concreteDark,
      this.capacity * 10,
    );

    const metroVentGeo = new THREE.BoxGeometry(1.6, 1.4, 2.5);
    metroVentGeo.translate(-8.5, 0.7, 0);
    this.metroVent = this.instanced(metroVentGeo, concreteDark, this.capacity * 2);

    const poleGeo = new THREE.BoxGeometry(0.24, 5.1, 0.24);
    poleGeo.translate(23.2, 2.55, 9.5);
    this.totemPole = this.instanced(poleGeo, poleMat, this.capacity);

    const signGeo = new THREE.BoxGeometry(3.2, 1.5, 0.18);
    signGeo.translate(23.2, 5.4, 9.5);
    this.totemSign = this.instanced(signGeo, accentMat, this.capacity, true);

    this.group.add(
      this.platformL,
      this.platformR,
      this.tactileL,
      this.tactileR,
      this.roof,
      this.fasciaL,
      this.fasciaR,
      this.pillars,
      this.hall,
      this.band,
      this.entrance,
      this.metroBase,
      this.metroHall,
      this.metroOpening,
      this.metroCap,
      this.metroSteps,
      this.metroVent,
      this.totemPole,
      this.totemSign,
    );

    this.setQuality('medium');
    this.resizeMetrics(viewportHeight, fovDeg);
  }

  private instanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    colored = false,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (colored) {
      const c = new THREE.Color(0xffffff);
      for (let i = 0; i < capacity; i++) mesh.setColorAt(i, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.group.add(mesh);
    return mesh;
  }

  private collectModels(
    network: NetworkFile,
    geometries: Map<string, LineGeometry>,
    stationPositions: Map<string, { x: number; y: number; z: number; color: string }>,
  ): StationModel[] {
    const lineColors = new Map(network.lines.map((line) => [line.id, line.color]));
    const sample: PathSample = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
    const models: StationModel[] = [];
    for (const station of network.stations) {
      const anchor = stationPositions.get(station.id);
      if (!anchor) continue;
      let geo: LineGeometry | null = null;
      let stationS = 0;
      for (const lineId of station.lines) {
        const candidate = geometries.get(lineId);
        if (!candidate) continue;
        const found = candidate.stations.find((s) => s.id === station.id);
        if (found) {
          geo = candidate;
          stationS = found.s;
          break;
        }
      }
      if (!geo) continue;
      geo.sampleAt(stationS, sample);
      models.push({
        id: station.id,
        name: station.name,
        x: anchor.x,
        y: anchor.y,
        z: anchor.z,
        yaw: Math.atan2(sample.tx, sample.tz),
        color: lineColors.get(station.lines[0]) || anchor.color,
        station,
        underground: station.stationType === 'underground',
      });
    }
    return models;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    if (quality === 'low') {
      this.fullRadius = 900;
      this.mediumRadius = 3600;
      this.fullCap = 12;
      this.mediumCap = 60;
    } else if (quality === 'high') {
      this.fullRadius = 2300;
      this.mediumRadius = 9000;
      this.fullCap = 40;
      this.mediumCap = 160;
    } else {
      this.fullRadius = 1600;
      this.mediumRadius = 6400;
      this.fullCap = 26;
      this.mediumCap = 110;
    }
    this.fullRadius *= this.metricScale;
    this.mediumRadius *= this.metricScale;
    this.lastUpdate = 0;
    this.lastKey = '';
  }

  /** Keep the LOD switch distance proportional to what the camera can actually resolve. */
  resizeMetrics(viewportHeight: number, fovDeg: number): void {
    const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
    const pixelsPerMeterAt1km = viewportHeight / (2 * tanHalf * 1000);
    this.metricScale = THREE.MathUtils.clamp(pixelsPerMeterAt1km / 18, 0.55, 1.6);
    this.setQuality(this.quality);
  }

  update(camera: THREE.PerspectiveCamera, overview: boolean): void {
    const now = performance.now();
    if (this.lastUpdate > 0 && now - this.lastUpdate < 280) return;
    this.lastUpdate = now;

    const full: Ranked[] = [];
    const medium: Ranked[] = [];
    if (!overview) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      const full2 = this.fullRadius * this.fullRadius;
      const med2 = this.mediumRadius * this.mediumRadius;
      for (const model of this.models) {
        const dx = model.x - cx;
        const dz = model.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= full2) full.push({ model, distance: d2 });
        else if (d2 <= med2) medium.push({ model, distance: d2 });
      }
      full.sort((a, b) => a.distance - b.distance);
      medium.sort((a, b) => a.distance - b.distance);
      full.length = Math.min(full.length, this.fullCap);
      medium.length = Math.min(medium.length, this.mediumCap);
    }

    const key = `${full.map((v) => v.model.id).join(',')}|${medium.map((v) => v.model.id).join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const detailed = new Set<string>();
    this.platformL.count = 0;
    this.platformR.count = 0;
    this.tactileL.count = 0;
    this.tactileR.count = 0;
    this.roof.count = 0;
    this.fasciaL.count = 0;
    this.fasciaR.count = 0;
    this.pillars.count = 0;
    this.hall.count = 0;
    this.band.count = 0;
    this.entrance.count = 0;
    this.metroBase.count = 0;
    this.metroHall.count = 0;
    this.metroOpening.count = 0;
    this.metroCap.count = 0;
    this.metroSteps.count = 0;
    this.metroVent.count = 0;
    this.totemPole.count = 0;
    this.totemSign.count = 0;

    for (const { model } of medium) {
      detailed.add(model.id);
      this.addMedium(model);
    }
    for (const { model } of full) {
      detailed.add(model.id);
      this.addMedium(model);
      this.addFull(model);
    }

    for (const mesh of [
      this.platformL,
      this.platformR,
      this.tactileL,
      this.tactileR,
      this.roof,
      this.fasciaL,
      this.fasciaR,
      this.pillars,
      this.hall,
      this.band,
      this.entrance,
      this.metroBase,
      this.metroHall,
      this.metroOpening,
      this.metroCap,
      this.metroSteps,
      this.metroVent,
      this.totemPole,
      this.totemSign,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }

    this.detailed = detailed;
  }

  private addMedium(model: StationModel): void {
    if (model.underground) {
      for (const z of [-16, 16]) {
        this.write(this.metroBase, model, 0, 0, z);
        this.write(this.metroHall, model, 0, 0, z);
        this.write(this.metroOpening, model, 0, 0, z);
        this.write(this.metroCap, model, 0, 0, z, true);
      }
      return;
    }
    this.write(this.platformL, model, 0, 0, 0);
    this.write(this.platformR, model, 0, 0, 0);
    this.write(this.roof, model, 0, 0, 0, true);
    this.write(this.fasciaL, model, 0, 0, 0, true);
    this.write(this.fasciaR, model, 0, 0, 0, true);
    this.write(this.hall, model, 0, 0, 0);
    this.write(this.band, model, 0, 0, 0, true);
  }

  private addFull(model: StationModel): void {
    if (model.underground) {
      for (const z of [-16, 16]) {
        for (let i = 0; i < 5; i++) {
          this.write(this.metroSteps, model, 6.4 + i * 0.68, 0.55 - i * 0.08, z);
        }
      }
      this.write(this.metroVent, model, 0, 0, -19);
      this.write(this.metroVent, model, 0, 0, 19);
      this.write(this.totemPole, model, -32, 0, 0);
      this.write(this.totemSign, model, -32, 0, 0, true);
      return;
    }
    this.write(this.tactileL, model, 0, 0, 0);
    this.write(this.tactileR, model, 0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const z = -34 + i * 12.4;
      this.write(this.pillars, model, -7.1, 0, z);
      this.write(this.pillars, model, 7.1, 0, z);
    }
    this.write(this.entrance, model, 0, 0, 0);
    this.write(this.totemPole, model, 0, 0, 0);
    this.write(this.totemSign, model, 0, 0, 0, true);
  }

  private write(
    mesh: THREE.InstancedMesh,
    model: StationModel,
    lx: number,
    ly: number,
    lz: number,
    colored = false,
  ): void {
    const index = mesh.count;
    if (index >= mesh.instanceMatrix.count) return;
    this.compose(model, lx, ly, lz);
    mesh.setMatrixAt(index, this.matrix);
    if (colored) {
      this.color.set(model.color);
      mesh.setColorAt(index, this.color);
    }
    mesh.count = index + 1;
  }

  private compose(model: StationModel, lx: number, ly: number, lz: number): void {
    const cos = Math.cos(model.yaw);
    const sin = Math.sin(model.yaw);
    this.pos.set(model.x + lx * cos + lz * sin, model.y + ly, model.z - lx * sin + lz * cos);
    this.quat.setFromAxisAngle(UP, model.yaw);
    this.matrix.compose(this.pos, this.quat, ONE);
  }

  getDetailedStationIds(): Set<string> {
    return this.detailed;
  }

  dispose(): void {
    for (const mesh of [
      this.platformL,
      this.platformR,
      this.tactileL,
      this.tactileR,
      this.roof,
      this.fasciaL,
      this.fasciaR,
      this.pillars,
      this.hall,
      this.band,
      this.entrance,
      this.metroBase,
      this.metroHall,
      this.metroOpening,
      this.metroCap,
      this.metroSteps,
      this.metroVent,
      this.totemPole,
      this.totemSign,
    ]) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      mesh.dispose();
    }
  }
}

function buildArchRoofGeometry(
  width: number,
  length: number,
  baseY: number,
  rise: number,
  segments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const halfW = width / 2;
  const halfL = length / 2;
  const cols = segments + 1;
  for (let zi = 0; zi < 2; zi++) {
    const z = zi === 0 ? -halfL : halfL;
    for (let i = 0; i <= segments; i++) {
      const x = -halfW + (width * i) / segments;
      const t = x / halfW;
      const y = baseY + rise * (1 - t * t);
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i;
    const b = i + 1;
    const c = cols + i;
    const d = cols + i + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
