import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { LineData, NetworkFile, StationData } from '@/data/types';
import { LineGeometry } from './LineGeometry';
import { TerrainSystem } from './Terrain';

interface LineVisual {
  id: string;
  color: string;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  aura: THREE.Mesh;
  overview: THREE.Mesh;
  casing: THREE.Mesh;
  deck: THREE.Mesh | null;
  coreMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  auraMat: THREE.MeshBasicMaterial;
  overviewMat: THREE.MeshBasicMaterial;
  casingMat: THREE.MeshBasicMaterial;
  deckMat: THREE.MeshLambertMaterial | null;
  bounds: [number, number, number, number];
  center: [number, number];
}

export class TransitLayer {
  readonly group = new THREE.Group();
  readonly labelGroup = new THREE.Group();
  readonly geometries = new Map<string, LineGeometry>();
  readonly stationPositions = new Map<string, { x: number; y: number; z: number; color: string }>();

  private visuals = new Map<string, LineVisual>();
  private stationMesh: THREE.InstancedMesh;
  private ringMesh: THREE.InstancedMesh;
  private labels: Array<{ object: CSS2DObject; stationId: string; x: number; z: number; y: number }> = [];
  private stationOrder: StationData[] = [];
  private selectedLineId: string | null = null;
  private labelsEnabled = true;
  private labelDistance = 12000;
  private overview = false;
  private railCells = new Set<string>();
  private readonly railCellSize = 15;

  constructor(network: NetworkFile, terrain: TerrainSystem) {
    const stationInfo = new Map<string, { x: number; y: number; z: number; color: string }>();

    for (const line of network.lines) {
      const geo = new LineGeometry(line, terrain);
      this.geometries.set(line.id, geo);
      for (let i = 0; i < geo.xs.length; i++) {
        const key = `${Math.floor(geo.xs[i] / this.railCellSize)}:${Math.floor(geo.zs[i] / this.railCellSize)}`;
        this.railCells.add(key);
      }
      const visual = this.buildLineVisual(line, geo);
      this.visuals.set(line.id, visual);
      for (const st of geo.stations) {
        if (!stationInfo.has(st.id)) {
          stationInfo.set(st.id, { x: st.x, y: st.y, z: st.z, color: line.color });
        }
      }
    }

    for (const st of network.stations) {
      const pos = stationInfo.get(st.id);
      if (pos) this.stationPositions.set(st.id, pos);
    }

    this.stationOrder = network.stations.filter((s) => this.stationPositions.has(s.id));
    this.stationMesh = this.buildStationMarkers();
    this.ringMesh = this.buildStationRings();
    this.buildLabels(network.stations);
  }

  private buildLineVisual(line: LineData, geo: LineGeometry): LineVisual {
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(line.color),
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(line.color),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      depthWrite: false,
    });
    const auraColor = new THREE.Color(line.color);
    const auraMat = new THREE.MeshBasicMaterial({
      color: auraColor,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
    const core = new THREE.Mesh(geo.buildRibbon(1.6, 0.55, geo.closedLoop), coreMat);
    core.frustumCulled = true;
    core.renderOrder = 4;
    const glow = new THREE.Mesh(geo.buildRibbon(3.2, 0.42, geo.closedLoop), glowMat);
    glow.frustumCulled = true;
    glow.renderOrder = 3;
    const casingMat = new THREE.MeshBasicMaterial({
      color: 0x0e1419,
      transparent: true,
      opacity: 0.86,
      toneMapped: false,
      depthWrite: false,
    });
    const casing = new THREE.Mesh(geo.buildRibbon(4.2, 0.4, geo.closedLoop), casingMat);
    casing.frustumCulled = true;
    casing.renderOrder = 2;
    const deckGeo = geo.buildBridgeDecks(10);
    let deck: THREE.Mesh | null = null;
    let deckMat: THREE.MeshLambertMaterial | null = null;
    if (deckGeo) {
      deckMat = new THREE.MeshLambertMaterial({ color: 0x3d444c });
      deck = new THREE.Mesh(deckGeo, deckMat);
      deck.frustumCulled = true;
      this.group.add(deck);
    }
    const aura = new THREE.Mesh(
      geo.buildRibbon(Math.max(160, line.length * 0.005), 0.3, geo.closedLoop),
      auraMat,
    );
    aura.frustumCulled = true;
    aura.renderOrder = 20;
    aura.visible = false;
    const overviewMat = new THREE.MeshBasicMaterial({
      color: auraColor,
      transparent: true,
      opacity: 0.82,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
    const overview = new THREE.Mesh(
      geo.buildRibbon(Math.max(22, line.length * 0.0009), 0.3, geo.closedLoop),
      overviewMat,
    );
    overview.frustumCulled = true;
    overview.renderOrder = 21;
    overview.visible = false;
    this.group.add(aura, overview, casing, glow, core);

    const b = line.bounds;
    const visual: LineVisual = {
      id: line.id,
      color: line.color,
      core,
      glow,
      aura,
      overview,
      casing,
      deck,
      coreMat,
      glowMat,
      auraMat,
      overviewMat,
      casingMat,
      deckMat,
      bounds: b,
      center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
    };
    return visual;
  }

  private buildStationMarkers(): THREE.InstancedMesh {
    const geo = new THREE.CylinderGeometry(2.6, 2.6, 10, 8);
    geo.translate(0, 5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.stationOrder.length));
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    this.stationOrder.forEach((st, i) => {
      const pos = this.stationPositions.get(st.id)!;
      m.makeTranslation(pos.x, pos.y - 2, pos.z);
      mesh.setMatrixAt(i, m);
      color.set(pos.color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildStationRings(): THREE.InstancedMesh {
    const geo = new THREE.TorusGeometry(6, 0.45, 4, 20);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.stationOrder.length));
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    this.stationOrder.forEach((st, i) => {
      const pos = this.stationPositions.get(st.id)!;
      m.makeTranslation(pos.x, pos.y + 0.6, pos.z);
      mesh.setMatrixAt(i, m);
      color.set(pos.color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildLabels(stations: StationData[]): void {
    for (const st of stations) {
      const pos = this.stationPositions.get(st.id);
      if (!pos) continue;
      const el = document.createElement('div');
      el.className = 'station-label';
      el.innerHTML = `<span class="dot" style="background:${pos.color}"></span><span>${st.name}</span>`;
      const obj = new CSS2DObject(el);
      obj.position.set(pos.x, pos.y + 16, pos.z);
      obj.visible = false;
      this.labelGroup.add(obj);
      this.labels.push({ object: obj, stationId: st.id, x: pos.x, z: pos.z, y: pos.y });
    }
  }

  setSelected(lineId: string | null): void {
    this.selectedLineId = lineId;
    for (const visual of this.visuals.values()) {
      const isSelected = lineId === null || visual.id === lineId;
      visual.coreMat.opacity = isSelected ? 0.95 : 0.2;
      visual.glowMat.opacity = lineId === null ? 0.16 : visual.id === lineId ? 0.34 : 0.03;
      visual.auraMat.opacity = lineId === null ? 0.1 : visual.id === lineId ? 0.16 : 0.03;
      visual.overviewMat.opacity = lineId === null ? 0.82 : visual.id === lineId ? 0.95 : 0.28;
    }
    if (lineId) {
      const visual = this.visuals.get(lineId);
      if (visual) {
        this.stationMesh.visible = true;
        this.ringMesh.visible = true;
      }
    }
  }

  setLabelsEnabled(enabled: boolean): void {
    this.labelsEnabled = enabled;
    if (!enabled) for (const l of this.labels) l.object.visible = false;
  }

  /** Overview mode hides per-station labels and shows the wide line halo. */
  setOverviewMode(overview: boolean): void {
    if (this.overview === overview) return;
    this.overview = overview;
    for (const visual of this.visuals.values()) {
      visual.aura.visible = overview;
      visual.overview.visible = overview;
    }
    if (overview) {
      for (const label of this.labels) label.object.visible = false;
    }
  }

  setLabelDistance(distance: number): void {
    this.labelDistance = distance;
  }

  update(camera: THREE.PerspectiveCamera): void {
    this.stationMesh.visible = true;
    this.ringMesh.visible = true;
    if (!this.labelsEnabled || this.overview) {
      for (const label of this.labels) {
        if (label.object.visible) label.object.visible = false;
      }
      return;
    }
    const cx = camera.position.x;
    const cz = camera.position.z;
    const maxDist2 = this.labelDistance * this.labelDistance;
    for (const label of this.labels) {
      const dx = label.x - cx;
      const dz = label.z - cz;
      const visible = dx * dx + dz * dz < maxDist2;
      if (label.object.visible !== visible) label.object.visible = visible;
    }
  }

  getLineBounds(lineId: string | null): { center: [number, number]; bounds: [number, number, number, number] } | null {
    if (!lineId) return null;
    const visual = this.visuals.get(lineId);
    if (!visual) return null;
    return { center: visual.center, bounds: visual.bounds };
  }

  getStation(id: string): StationData | null {
    return this.stationOrder.find((s) => s.id === id) || null;
  }

  /** True when a point is within ~40 m of any rendered track (used to clear building footprints). */
  nearRail(x: number, z: number): boolean {
    const cx = Math.floor(x / this.railCellSize);
    const cz = Math.floor(z / this.railCellSize);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (this.railCells.has(`${cx + i}:${cz + j}`)) return true;
      }
    }
    return false;
  }

  pickStation(camera: THREE.PerspectiveCamera, pointer: THREE.Vector2): StationData | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(this.stationMesh, false);
    if (!hits.length || hits[0].instanceId == null) return null;
    return this.stationOrder[hits[0].instanceId] || null;
  }

  highLightStation(id: string | null): void {
    // reserved for future emphasis
    void id;
  }

  dispose(): void {
    for (const visual of this.visuals.values()) {
      visual.casing.geometry.dispose();
      visual.core.geometry.dispose();
      visual.glow.geometry.dispose();
      visual.aura.geometry.dispose();
      visual.overview.geometry.dispose();
      visual.coreMat.dispose();
      visual.glowMat.dispose();
      visual.auraMat.dispose();
      visual.overviewMat.dispose();
      visual.casingMat.dispose();
      visual.deckMat?.dispose();
      visual.deck?.geometry.dispose();
    }
    this.stationMesh.geometry.dispose();
    (this.stationMesh.material as THREE.Material).dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
  }
}
