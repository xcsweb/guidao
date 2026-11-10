import * as THREE from 'three';
import type { NetworkFile, StationData } from '@/data/types';
import type { LineGeometry, PathSample } from './LineGeometry';
import type { StationPosition } from './TransitLayer';
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
  private metroRoof: THREE.InstancedMesh;
  private metroFrame: THREE.InstancedMesh;
  private metroLintel: THREE.InstancedMesh;
  private metroPit: THREE.InstancedMesh;
  private metroSteps: THREE.InstancedMesh;
  private metroHandrail: THREE.InstancedMesh;
  private metroVent: THREE.InstancedMesh;
  private metroVentGrille: THREE.InstancedMesh;
  private metroMarkerFace: THREE.InstancedMesh;
  private totemPole: THREE.InstancedMesh;
  private totemSign: THREE.InstancedMesh;
  private ribs: THREE.InstancedMesh;
  private canopyLights: THREE.InstancedMesh;
  private benchSeat: THREE.InstancedMesh;
  private benchBack: THREE.InstancedMesh;
  private benchLeg: THREE.InstancedMesh;
  private metroRibs: THREE.InstancedMesh;
  private deck: THREE.InstancedMesh;
  private deckGirder: THREE.InstancedMesh;
  private deckPier: THREE.InstancedMesh;
  private roofEdge: THREE.InstancedMesh;
  private skylight: THREE.InstancedMesh;
  private hallGlass: THREE.InstancedMesh;
  private hallGlassSide: THREE.InstancedMesh;
  private hallRoof: THREE.InstancedMesh;
  private roofBattens: THREE.InstancedMesh;
  private plaza: THREE.InstancedMesh;
  private plazaPath: THREE.InstancedMesh;
  private planter: THREE.InstancedMesh;
  private hedge: THREE.InstancedMesh;
  private metroConcreteTexture: THREE.CanvasTexture;
  private metroMarkerTexture: THREE.CanvasTexture;

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
    stationPositions: Map<string, StationPosition>,
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
      color: 0x55626a,
      side: THREE.DoubleSide,
    });
    const accentMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x969ea3 });
    this.metroConcreteTexture = makeMetroConcreteTexture();
    this.metroMarkerTexture = makeMetroMarkerTexture();
    const metroConcreteMat = new THREE.MeshLambertMaterial({
      color: 0xc3c9ca,
      map: this.metroConcreteTexture,
    });
    const metroGlassMat = new THREE.MeshLambertMaterial({
      color: 0x9fc9d5,
      emissive: 0x162d36,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    const metroMetalMat = new THREE.MeshLambertMaterial({ color: 0x596970 });
    const metroRoofMat = new THREE.MeshLambertMaterial({ color: 0x43545d });
    const openingMat = new THREE.MeshBasicMaterial({ color: 0x0b1419 });
    const metroMarkerMat = new THREE.MeshBasicMaterial({
      map: this.metroMarkerTexture,
      toneMapped: false,
    });
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
    this.roof = this.instanced(roofGeo, roofMat, this.capacity);

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
    this.metroBase = this.instanced(metroBaseGeo, metroConcreteMat, this.capacity * 2);

    const metroHallGeo = new THREE.BoxGeometry(4.6, 3, 5.8);
    metroHallGeo.translate(11.1, 1.72, 0);
    this.metroHall = this.instanced(metroHallGeo, metroGlassMat, this.capacity * 2);

    const metroOpeningGeo = new THREE.BoxGeometry(0.14, 2.35, 3.6);
    metroOpeningGeo.translate(8.74, 1.35, 0);
    this.metroOpening = this.instanced(metroOpeningGeo, openingMat, this.capacity * 2);

    const metroCapGeo = new THREE.BoxGeometry(0.18, 0.34, 6.6);
    metroCapGeo.translate(8.02, 3.34, 0);
    this.metroCap = this.instanced(metroCapGeo, accentMat, this.capacity * 2, true);

    const metroRoofGeo = new THREE.BoxGeometry(6.2, 0.22, 7);
    metroRoofGeo.translate(10.85, 3.5, 0);
    this.metroRoof = this.instanced(metroRoofGeo, metroRoofMat, this.capacity * 2);

    this.metroFrame = this.instanced(
      new THREE.BoxGeometry(0.2, 3.15, 0.2),
      metroMetalMat,
      this.capacity * 10,
    );
    this.metroLintel = this.instanced(
      new THREE.BoxGeometry(0.24, 0.24, 5.55),
      metroMetalMat,
      this.capacity * 4,
    );

    const metroPitGeo = new THREE.BoxGeometry(4.6, 0.035, 3.9);
    metroPitGeo.translate(6.85, 0.265, 0);
    this.metroPit = this.instanced(metroPitGeo, openingMat, this.capacity * 2);

    this.metroSteps = this.instanced(
      new THREE.BoxGeometry(0.62, 0.12, 3.4),
      metroConcreteMat,
      this.capacity * 12,
    );
    const metroHandrailGeo = new THREE.BoxGeometry(4, 0.075, 0.075);
    metroHandrailGeo.rotateZ(-0.12);
    this.metroHandrail = this.instanced(metroHandrailGeo, metroMetalMat, this.capacity * 4);

    const metroVentGeo = new THREE.BoxGeometry(1.6, 1.4, 2.5);
    metroVentGeo.translate(-8.5, 0.7, 0);
    this.metroVent = this.instanced(metroVentGeo, metroMetalMat, this.capacity * 2);
    this.metroVentGrille = this.instanced(
      new THREE.BoxGeometry(0.07, 0.065, 2.12),
      openingMat,
      this.capacity * 12,
    );

    const metroMarkerGeo = new THREE.PlaneGeometry(2.8, 1.15);
    metroMarkerGeo.translate(23.2, 5.4, 9.601);
    this.metroMarkerFace = this.instanced(metroMarkerGeo, metroMarkerMat, this.capacity);

    const poleGeo = new THREE.BoxGeometry(0.24, 5.1, 0.24);
    poleGeo.translate(23.2, 2.55, 9.5);
    this.totemPole = this.instanced(poleGeo, poleMat, this.capacity);

    const signGeo = new THREE.BoxGeometry(3.2, 1.5, 0.18);
    signGeo.translate(23.2, 5.4, 9.5);
    this.totemSign = this.instanced(signGeo, accentMat, this.capacity, true);

    // Canopy structure: arched ribs, soffit light lines and platform benches.
    this.ribs = this.instanced(
      buildArchRibGeometry(15.6, 4.55, 1.15, 0.085),
      concreteDark,
      this.capacity * 13,
    );
    this.canopyLights = this.instanced(
      new THREE.BoxGeometry(0.16, 0.055, 5.4),
      new THREE.MeshBasicMaterial({ color: 0xfff1cd, toneMapped: false }),
      this.capacity * 12,
    );
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x4d6068 });
    this.benchSeat = this.instanced(
      new THREE.BoxGeometry(0.6, 0.1, 2.2),
      benchMat,
      this.capacity * 4,
    );
    this.benchBack = this.instanced(
      new THREE.BoxGeometry(0.12, 0.62, 2.2),
      benchMat,
      this.capacity * 4,
    );
    this.benchLeg = this.instanced(
      new THREE.BoxGeometry(0.1, 0.44, 0.1),
      poleMat,
      this.capacity * 16,
    );
    this.metroRibs = this.instanced(
      new THREE.BoxGeometry(6.2, 0.07, 0.12),
      metroMetalMat,
      this.capacity * 6,
    );

    // Elevated station substructure, so platforms sit on a real viaduct deck.
    const structureMat = new THREE.MeshLambertMaterial({ color: 0x7d868b });
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8e969a });
    this.deck = this.instanced(
      new THREE.BoxGeometry(4.9, 0.85, 91),
      deckMat,
      this.capacity * 2,
    );
    this.deckGirder = this.instanced(
      new THREE.BoxGeometry(0.66, 1.2, 91),
      structureMat,
      this.capacity * 2,
    );
    this.deckPier = this.instanced(
      new THREE.BoxGeometry(1.1, 2.9, 1.1),
      structureMat,
      this.capacity * 6,
    );
    this.roofEdge = this.instanced(
      new THREE.BoxGeometry(0.42, 0.28, 86),
      concreteDark,
      this.capacity * 2,
    );
    this.skylight = this.instanced(
      new THREE.BoxGeometry(2.2, 0.07, 83),
      new THREE.MeshBasicMaterial({
        color: 0x9ec6d2,
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
      }),
      this.capacity,
    );
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x13272e, emissive: 0x0a1b21 });
    this.hallGlass = this.instanced(
      new THREE.BoxGeometry(0.09, 1.9, 14.4),
      glassMat,
      this.capacity,
    );
    this.hallGlassSide = this.instanced(
      new THREE.BoxGeometry(12.4, 1.9, 0.09),
      glassMat,
      this.capacity * 2,
    );
    this.hallRoof = this.instanced(
      new THREE.BoxGeometry(14.4, 0.34, 17.4),
      structureMat,
      this.capacity,
    );
    // Standing-seam battens keep the large canopy from reading as a flat slab.
    this.roofBattens = this.instanced(
      new THREE.BoxGeometry(0.11, 0.05, 84),
      new THREE.MeshLambertMaterial({ color: 0x6d787f }),
      this.capacity * 15,
    );

    // Street-level paving and planting around underground entrances.
    this.plaza = this.instanced(
      new THREE.BoxGeometry(9.6, 0.18, 12.6),
      new THREE.MeshLambertMaterial({ color: 0x8b9296 }),
      this.capacity * 2,
    );
    this.plazaPath = this.instanced(
      new THREE.BoxGeometry(3.4, 0.16, 32),
      new THREE.MeshLambertMaterial({ color: 0x848b8f }),
      this.capacity,
    );
    this.planter = this.instanced(
      new THREE.BoxGeometry(2.4, 0.55, 1.1),
      new THREE.MeshLambertMaterial({ color: 0x767f83 }),
      this.capacity * 4,
    );
    this.hedge = this.instanced(
      new THREE.BoxGeometry(2.16, 0.5, 0.88),
      new THREE.MeshLambertMaterial({ color: 0x2f4a36 }),
      this.capacity * 4,
    );

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
      this.metroRoof,
      this.metroFrame,
      this.metroLintel,
      this.metroPit,
      this.metroSteps,
      this.metroHandrail,
      this.metroVent,
      this.metroVentGrille,
      this.metroMarkerFace,
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
    stationPositions: Map<string, StationPosition>,
  ): StationModel[] {
    const lineColors = new Map(network.lines.map((line) => [line.id, line.color]));
    const sample: PathSample = { x: 0, z: 0, y: 0, tx: 0, tz: 0 };
    const models: StationModel[] = [];
    for (const station of network.stations) {
      const anchor = stationPositions.get(station.id);
      if (!anchor) continue;
      const geo = geometries.get(anchor.lineId);
      const point = geo?.stations.find((s) => s.id === station.id);
      if (!geo || !point) continue;
      geo.sampleAt(point.s, sample);
      const underground = station.stationType === 'underground';
      models.push({
        id: station.id,
        name: station.name,
        x: anchor.x,
        y: underground ? anchor.groundY : anchor.trackY,
        z: anchor.z,
        yaw: Math.atan2(sample.tx, sample.tz),
        color: lineColors.get(anchor.lineId) || anchor.color,
        station,
        underground,
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
    this.metroRoof.count = 0;
    this.metroFrame.count = 0;
    this.metroLintel.count = 0;
    this.metroPit.count = 0;
    this.metroSteps.count = 0;
    this.metroHandrail.count = 0;
    this.metroVent.count = 0;
    this.metroVentGrille.count = 0;
    this.metroMarkerFace.count = 0;
    this.totemPole.count = 0;
    this.totemSign.count = 0;
    this.ribs.count = 0;
    this.canopyLights.count = 0;
    this.benchSeat.count = 0;
    this.benchBack.count = 0;
    this.benchLeg.count = 0;
    this.metroRibs.count = 0;
    this.deck.count = 0;
    this.deckGirder.count = 0;
    this.deckPier.count = 0;
    this.roofEdge.count = 0;
    this.skylight.count = 0;
    this.hallGlass.count = 0;
    this.hallGlassSide.count = 0;
    this.hallRoof.count = 0;
    this.roofBattens.count = 0;
    this.plaza.count = 0;
    this.plazaPath.count = 0;
    this.planter.count = 0;
    this.hedge.count = 0;

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
      this.metroRoof,
      this.metroFrame,
      this.metroLintel,
      this.metroPit,
      this.metroSteps,
      this.metroHandrail,
      this.metroVent,
      this.metroVentGrille,
      this.metroMarkerFace,
      this.totemPole,
      this.totemSign,
      this.ribs,
      this.canopyLights,
      this.benchSeat,
      this.benchBack,
      this.benchLeg,
      this.metroRibs,
      this.deck,
      this.deckGirder,
      this.deckPier,
      this.roofEdge,
      this.skylight,
      this.hallGlass,
      this.hallGlassSide,
      this.hallRoof,
      this.roofBattens,
      this.plaza,
      this.plazaPath,
      this.planter,
      this.hedge,
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
        this.write(this.metroRoof, model, 0, 0, z);
        this.write(this.metroPit, model, 0, 0, z);
        for (const x of [8.6, 13.45]) {
          for (const dz of [-2.65, 2.65]) {
            this.write(this.metroFrame, model, x, 1.66, z + dz);
          }
          this.write(this.metroLintel, model, x, 3.18, z);
        }
        for (const dz of [-2.15, 0, 2.15]) {
          this.write(this.metroRibs, model, 10.85, 3.6, z + dz);
        }
        this.write(this.plaza, model, 18.4, 0.09, z);
        for (const pz of [z - 6.2, z + 6.2]) {
          this.write(this.planter, model, 18.4, 0.45, pz);
          this.write(this.hedge, model, 18.4, 0.9, pz);
        }
      }
      this.write(this.plazaPath, model, 18.4, 0.08, 0);
      return;
    }
    this.write(this.platformL, model, 0, 0, 0);
    this.write(this.platformR, model, 0, 0, 0);
    this.write(this.roof, model, 0, 0, 0);
    this.write(this.fasciaL, model, 0, 0, 0, true);
    this.write(this.fasciaR, model, 0, 0, 0, true);
    this.write(this.hall, model, 0, 0, 0);
    this.write(this.band, model, 0, 0, 0, true);
    this.write(this.deck, model, -5.15, 0, 0);
    this.write(this.deck, model, 5.15, 0, 0);
    this.write(this.deckGirder, model, -7.42, -0.12, 0);
    this.write(this.deckGirder, model, 7.42, -0.12, 0);
    this.write(this.roofEdge, model, -7.55, 4.5, 0);
    this.write(this.roofEdge, model, 7.55, 4.5, 0);
    this.write(this.skylight, model, 0, 5.72, 0);
    this.write(this.hallGlass, model, 9.04, 4.4, 0);
    this.write(this.hallGlassSide, model, 15.5, 4.4, 8.06);
    this.write(this.hallGlassSide, model, 15.5, 4.4, -8.06);
    this.write(this.hallRoof, model, 15.5, 7.36, 0);
    for (let i = 0; i < 15; i++) {
      const x = -7 + i;
      const t = x / 7.8;
      this.write(this.roofBattens, model, x, 4.55 + 1.15 * (1 - t * t) + 0.03, 0);
    }
  }

  private addFull(model: StationModel): void {
    if (model.underground) {
      for (const z of [-16, 16]) {
        this.write(this.metroFrame, model, 8.6, 1.66, z);
        for (let i = 0; i < 6; i++) {
          this.write(this.metroSteps, model, 5.25 + i * 0.62, 0.58 - i * 0.075, z);
        }
        for (const dz of [-1.96, 1.96]) {
          this.write(this.metroHandrail, model, 6.85, 1.02, z + dz);
        }
      }
      const grilleCount = this.quality === 'high' ? 6 : this.quality === 'medium' ? 4 : 3;
      for (const z of [-19, 19]) {
        this.write(this.metroVent, model, 0, 0, z);
        for (let i = 0; i < grilleCount; i++) {
          const y = 0.72 + (i - (grilleCount - 1) * 0.5) * 0.15;
          this.write(this.metroVentGrille, model, -7.66, y, z);
        }
      }
      this.write(this.totemPole, model, -32, 0, 0);
      this.write(this.totemSign, model, -32, 0, 0, true);
      this.write(this.metroMarkerFace, model, -32, 0, 0);
      return;
    }
    this.write(this.tactileL, model, 0, 0, 0);
    this.write(this.tactileR, model, 0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const z = -34 + i * 12.4;
      this.write(this.pillars, model, -7.1, 0, z);
      this.write(this.pillars, model, 7.1, 0, z);
    }
    for (let i = 0; i < 13; i++) {
      this.write(this.ribs, model, 0, 0, -36 + i * 6);
    }
    for (const z of [-30, 0, 30]) {
      for (const x of [-5.15, 5.15]) {
        this.write(this.deckPier, model, x, -1.87, z);
      }
    }
    for (let i = 0; i < 6; i++) {
      const z = -30 + i * 12;
      this.write(this.canopyLights, model, -3.2, 5.28, z);
      this.write(this.canopyLights, model, 3.2, 5.28, z);
    }
    for (const z of [-14, 14]) {
      for (const x of [-6.3, 6.3]) {
        this.write(this.benchSeat, model, x, 1.44, z);
        this.write(this.benchBack, model, x + Math.sign(x) * 0.24, 1.79, z);
        this.write(this.benchLeg, model, x, 1.22, z - 0.8);
        this.write(this.benchLeg, model, x, 1.22, z + 0.8);
      }
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

  /** Replaces one procedural part with the Blender-authored high detail mesh. */
  applyDetailGeometry(name: string, geometry: THREE.BufferGeometry): boolean {
    let target: THREE.InstancedMesh | null = null;
    switch (name) {
      case 'station_canopy':
        target = this.roof;
        break;
      case 'station_rib':
        target = this.ribs;
        break;
      case 'station_platform_left':
        target = this.platformL;
        break;
      case 'station_platform_right':
        target = this.platformR;
        break;
      case 'station_hall':
        target = this.hall;
        break;
      case 'station_deck':
        target = this.deck;
        break;
      case 'station_girder':
        target = this.deckGirder;
        break;
      default:
        return false;
    }
    target.geometry.dispose();
    target.geometry = geometry;
    return true;
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
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
      this.metroRoof,
      this.metroFrame,
      this.metroLintel,
      this.metroPit,
      this.metroSteps,
      this.metroHandrail,
      this.metroVent,
      this.metroVentGrille,
      this.metroMarkerFace,
      this.totemPole,
      this.totemSign,
      this.ribs,
      this.canopyLights,
      this.benchSeat,
      this.benchBack,
      this.benchLeg,
      this.metroRibs,
      this.deck,
      this.deckGirder,
      this.deckPier,
      this.roofEdge,
      this.skylight,
      this.hallGlass,
      this.hallGlassSide,
      this.hallRoof,
      this.roofBattens,
      this.plaza,
      this.plazaPath,
      this.planter,
      this.hedge,
    ]) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => materials.add(m));
      else materials.add(material);
      mesh.dispose();
    }
    for (const material of materials) material.dispose();
    this.metroConcreteTexture.dispose();
    this.metroMarkerTexture.dispose();
  }
}

function makeMetroConcreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext?.('2d');
  if (ctx) {
    ctx.fillStyle = '#b8c0c2';
    ctx.fillRect(0, 0, 96, 96);
    ctx.strokeStyle = 'rgba(75,88,92,0.28)';
    ctx.lineWidth = 1;
    for (const p of [0, 32, 64, 96]) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 96);
      ctx.moveTo(0, p);
      ctx.lineTo(96, p);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(55,65,68,0.12)';
    for (let i = 0; i < 48; i++) ctx.fillRect((i * 37) % 96, (i * 61) % 96, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeMetroMarkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext?.('2d');
  if (ctx) {
    ctx.fillStyle = '#f2f6f6';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#17333f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 142px Arial, sans-serif';
    ctx.fillText('M', 100, 122);
    ctx.textAlign = 'left';
    ctx.font = '700 74px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('地铁', 202, 99);
    ctx.fillStyle = '#58717b';
    ctx.font = '600 34px Arial, sans-serif';
    ctx.fillText('METRO', 205, 175);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A slim arch rib, used under the canopy to read as structure rather than a shell. */
function buildArchRibGeometry(
  width: number,
  baseY: number,
  rise: number,
  radius: number,
): THREE.BufferGeometry {
  const halfW = width / 2;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = -halfW + (width * i) / 10;
    const t = x / halfW;
    points.push(new THREE.Vector3(x, baseY + rise * (1 - t * t) - radius * 1.4, 0));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 24, radius, 5, false);
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
