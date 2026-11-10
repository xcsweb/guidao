import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { LineData, NetworkFile, StationData } from '@/data/types';
import { LineGeometry, type StationPoint } from './LineGeometry';
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

export interface StationPosition {
  x: number;
  /** Natural street anchor for underground stations; track anchor otherwise. */
  y: number;
  z: number;
  color: string;
  /** Natural DEM elevation, independent of the rail profile. */
  groundY: number;
  /** Rail/platform elevation on the selected, surface-prioritized line. */
  trackY: number;
  lineId: string;
}

export class TransitLayer {
  readonly group = new THREE.Group();
  readonly labelGroup = new THREE.Group();
  readonly geometries = new Map<string, LineGeometry>();
  readonly stationPositions = new Map<string, StationPosition>();

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
  private hiddenStations: Set<string> = new Set();
  private trackBedTexture: THREE.CanvasTexture;

  constructor(network: NetworkFile, terrain: TerrainSystem) {
    this.trackBedTexture = makeTrackBedTexture();
    for (const line of network.lines) {
      const geo = new LineGeometry(line, terrain);
      this.geometries.set(line.id, geo);
      for (let i = 0; i < geo.xs.length; i++) {
        const key = `${Math.floor(geo.xs[i] / this.railCellSize)}:${Math.floor(geo.zs[i] / this.railCellSize)}`;
        this.railCells.add(key);
      }
      const visual = this.buildLineVisual(line, geo);
      this.visuals.set(line.id, visual);
    }

    for (const station of network.stations) {
      const ranges = new Set<boolean>();
      let selected: {
        lineId: string;
        color: string;
        point: StationPoint;
        underground: boolean;
      } | null = null;
      for (const lineId of station.lines) {
        const geo = this.geometries.get(lineId);
        const point = geo?.stations.find((item) => item.id === station.id);
        if (!geo || !point) continue;
        const underground = geo.isInsideTunnel(point.s);
        ranges.add(underground);
        if (!selected || (selected.underground && !underground)) {
          selected = {
            lineId,
            color: geo.line.color,
            point,
            underground,
          };
        }
      }
      station.stationType = ranges.size > 1
        ? 'mixed'
        : ranges.has(true)
          ? 'underground'
          : 'surface';
      if (selected) {
        const { point } = selected;
        this.stationPositions.set(station.id, {
          x: point.x,
          y: station.stationType === 'underground' ? point.groundY : point.y,
          z: point.z,
          color: selected.color,
          groundY: point.groundY,
          trackY: point.y,
          lineId: selected.lineId,
        });
      }
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
      map: this.trackBedTexture,
      color: 0xdfe6ea,
      transparent: true,
      opacity: 0.92,
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
    const undergroundColor = new THREE.Color(0x9db5c9);
    this.stationOrder.forEach((st, i) => {
      const pos = this.stationPositions.get(st.id)!;
      m.makeTranslation(pos.x, pos.y + 0.6, pos.z);
      mesh.setMatrixAt(i, m);
      color.set(pos.color);
      if (st.stationType === 'underground') color.lerp(undergroundColor, 0.72);
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
      if (st.stationType) el.dataset.kind = st.stationType;
      const kindLabel = st.stationType === 'underground'
        ? '地下站'
        : st.stationType === 'mixed'
          ? '地上 / 地下混合'
          : '地面 / 高架站';
      el.title = `${st.name} · ${kindLabel}`;
      el.innerHTML = `<span class="dot" style="background:${pos.color}"></span><span>${st.name}</span>`;
      const obj = new CSS2DObject(el);
      const labelHeight = st.stationType === 'underground' ? 32 : 16;
      obj.position.set(pos.x, pos.y + labelHeight, pos.z);
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
      visual.aura.visible = false;
      visual.overview.visible = overview;
      visual.casing.visible = !overview;
      visual.glow.visible = !overview;
      visual.core.visible = !overview;
    }
    if (overview) {
      for (const label of this.labels) label.object.visible = false;
    }
  }

  setLabelDistance(distance: number): void {
    this.labelDistance = distance;
  }

  /** Collapse the icon markers for stations that now have a detailed 3D model. */
  setStationMarkersHidden(ids: Set<string>): void {
    if (ids.size === this.hiddenStations.size) {
      let same = true;
      for (const id of ids) {
        if (!this.hiddenStations.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.hiddenStations = new Set(ids);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.stationOrder.forEach((st, i) => {
      const anchor = this.stationPositions.get(st.id);
      if (!anchor) return;
      const hidden = this.hiddenStations.has(st.id);
      scale.set(1, hidden ? 0.001 : 1, 1);
      pos.set(anchor.x, anchor.y - 2, anchor.z);
      matrix.compose(pos, quat, scale);
      this.stationMesh.setMatrixAt(i, matrix);
      pos.set(anchor.x, anchor.y + 0.6, anchor.z);
      matrix.compose(pos, quat, scale);
      this.ringMesh.setMatrixAt(i, matrix);
    });
    this.stationMesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.instanceMatrix.needsUpdate = true;
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

  pickStation(
    camera: THREE.PerspectiveCamera,
    pointer: THREE.Vector2,
    viewportWidth: number,
    viewportHeight: number,
    viewportLeft = 0,
    viewportTop = 0,
  ): StationData | null {
    const tolerance = viewportWidth < 768 ? 24 : 18;
    const clientX = viewportLeft + ((pointer.x + 1) * viewportWidth) / 2;
    const clientY = viewportTop + ((1 - pointer.y) * viewportHeight) / 2;
    let bestDistance = Infinity;
    let best: StationData | null = null;

    if (this.labelsEnabled && !this.overview) {
      // CSS2D labels are the visible hit targets. Reading their screen rects keeps
      // picking aligned with the rendered text, including dynamic pixel ratios.
      for (const label of this.labels) {
        if (!label.object.visible) continue;
        const rect = label.object.element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const distance = dx * dx + dy * dy;
        const insideLabel = Math.abs(dx) <= rect.width / 2 + 6 &&
          Math.abs(dy) <= rect.height / 2 + 6;
        if ((insideLabel || distance <= tolerance * tolerance) && distance < bestDistance) {
          bestDistance = distance;
          best = this.getStation(label.stationId);
        }
      }
      return best;
    }

    // With labels hidden, retain picking on the projected 3D station markers.
    const world = new THREE.Vector3();
    const view = new THREE.Vector3();
    bestDistance = tolerance * tolerance;
    for (const station of this.stationOrder) {
      const pos = this.stationPositions.get(station.id);
      if (!pos) continue;
      world.set(pos.x, pos.y + 16, pos.z);
      view.copy(world).applyMatrix4(camera.matrixWorldInverse);
      if (view.z >= -camera.near) continue;
      world.project(camera);
      if (world.z < -1 || world.z > 1) continue;
      const dx = ((world.x - pointer.x) * viewportWidth) / 2;
      const dy = ((world.y - pointer.y) * viewportHeight) / 2;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = station;
      }
    }
    return best;
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
    this.trackBedTexture.dispose();
  }
}

/**
 * Ballast with sleepers, mapped through the ribbon UVs (v advances 20 m per
 * tile), so surface track reads as a real track bed instead of a flat casing.
 */
function makeTrackBedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx) {
    const bed = ctx.createLinearGradient(0, 0, 128, 0);
    bed.addColorStop(0, '#141b20');
    bed.addColorStop(0.1, '#1f282e');
    bed.addColorStop(0.5, '#232d34');
    bed.addColorStop(0.9, '#1f282e');
    bed.addColorStop(1, '#141b20');
    ctx.fillStyle = bed;
    ctx.fillRect(0, 0, 128, 512);

    let seed = 20261110;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1100; i++) {
      const tone = 110 + Math.floor(random() * 70);
      ctx.fillStyle = `rgba(${tone}, ${tone + 8}, ${tone + 12}, ${0.05 + random() * 0.06})`;
      ctx.fillRect(random() * 128, random() * 512, 1 + random() * 2.2, 1 + random() * 2.2);
    }

    const sleepers = 30;
    const step = 512 / sleepers;
    for (let i = 0; i < sleepers; i++) {
      const y = i * step + step * 0.28;
      const h = step * 0.44;
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, 'rgba(96, 106, 111, 0.62)');
      grad.addColorStop(1, 'rgba(58, 66, 71, 0.4)');
      ctx.fillStyle = grad;
      ctx.fillRect(14, y, 100, h);
      ctx.fillStyle = 'rgba(4, 8, 10, 0.42)';
      ctx.fillRect(14, y + h, 100, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
