import * as THREE from 'three';
import type { Quality } from '@/state/store';
import type { LineGeometry, PathSample, StationPoint } from './LineGeometry';
import {
  loadThirdPartyProp,
  ThirdPartyInstances,
  type ThirdPartyPropName,
} from './ModelKit';

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const UNDERGROUND_PROP_KEYS: ThirdPartyPropName[] = ['bench', 'vending', 'trash', 'exit'];
const UNDERGROUND_PLATFORM_Y = 1.05;

interface ProfilePoint {
  lat: number;
  y: number;
}

interface StationContext {
  station: StationPoint;
  range: [number, number];
  side: 1 | -1;
  key: string;
}

// Horseshoe cross-section of a bored tunnel, measured from the rail plane.
const PROFILE: ProfilePoint[] = [
  { lat: -4.5, y: -1.15 },
  { lat: -4.5, y: 1.9 },
  { lat: -4.05, y: 3.5 },
  { lat: -2.5, y: 4.85 },
  { lat: 0, y: 5.35 },
  { lat: 2.5, y: 4.85 },
  { lat: 4.05, y: 3.5 },
  { lat: 4.5, y: 1.9 },
  { lat: 4.5, y: -1.15 },
];

/**
 * Local, camera-sized underground set: tunnel shell, ballast, rails, ceiling
 * luminaires, light pools and an underground platform with a reading sign.
 * Only the part of the tunnel around the followed train is built, so the
 * overview map is untouched and the underground illusion stays convincing.
 */
export class TunnelLayer {
  readonly group = new THREE.Group();

  private shellMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private ballastMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private railMeshL: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private railMeshR: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private capMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

  private fixtureMesh: THREE.InstancedMesh;
  private poolMesh: THREE.InstancedMesh;
  private platformGroup = new THREE.Group();
  private platformDetails = new THREE.Group();
  private platformSigns = new THREE.Group();
  private signalGroup = new THREE.Group();

  private doorGlassMesh: THREE.InstancedMesh;
  private doorPostMesh: THREE.InstancedMesh;
  private doorHeaderMesh: THREE.InstancedMesh;
  private doorMeetingMesh: THREE.InstancedMesh;
  private doorSillMesh: THREE.InstancedMesh;
  private columnMesh: THREE.InstancedMesh;
  private columnBaseMesh: THREE.InstancedMesh;
  private columnCapMesh: THREE.InstancedMesh;
  private columnBandMesh: THREE.InstancedMesh;
  private beamMesh: THREE.InstancedMesh;
  private conduitMesh: THREE.InstancedMesh;
  private benchSeatMesh: THREE.InstancedMesh;
  private benchBackMesh: THREE.InstancedMesh;
  private benchLegMesh: THREE.InstancedMesh;
  private benchArmMesh: THREE.InstancedMesh;
  private platformLightMesh: THREE.InstancedMesh;
  private wallLightMesh: THREE.InstancedMesh;
  private platformPoolMesh: THREE.InstancedMesh;
  private directionBoardMesh: THREE.InstancedMesh;
  private signHangerMesh: THREE.InstancedMesh;
  private endWallMesh: THREE.InstancedMesh;
  private endHeaderMesh: THREE.InstancedMesh;
  private stationInstances: THREE.InstancedMesh[] = [];

  private shellMat: THREE.MeshBasicMaterial;
  private ballastMat: THREE.MeshLambertMaterial;
  private railMat: THREE.MeshBasicMaterial;
  private capMat: THREE.MeshBasicMaterial;
  private fixtureMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private platformMat: THREE.MeshLambertMaterial;
  private platformFaceMat: THREE.MeshLambertMaterial;
  private tactileMat: THREE.MeshBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private wallMat: THREE.MeshLambertMaterial;
  private wallBaseMat: THREE.MeshLambertMaterial;
  private ceilingMat: THREE.MeshLambertMaterial;
  private lineMat: THREE.MeshBasicMaterial;
  private doorGlassMat: THREE.MeshLambertMaterial;
  private doorFrameMat: THREE.MeshLambertMaterial;
  private benchMat: THREE.MeshLambertMaterial;
  private platformLightMat: THREE.MeshBasicMaterial;
  private signalMat = new THREE.MeshBasicMaterial({ color: 0x8ef3a6, toneMapped: false });
  private signalGeo = new THREE.SphereGeometry(0.18, 8, 6);
  private signGeo = new THREE.PlaneGeometry(6.8, 1.7);
  private directionSignGeo = new THREE.PlaneGeometry(3.55, 0.72);
  private directionSignMat: THREE.MeshBasicMaterial;

  private ballastTexture: THREE.CanvasTexture;
  private poolTexture: THREE.CanvasTexture;
  private platformTexture: THREE.CanvasTexture;
  private wallTexture: THREE.CanvasTexture;
  private tactileTexture: THREE.CanvasTexture;
  private signCache = new Map<string, THREE.MeshBasicMaterial>();
  private thirdPartyProps: Partial<Record<ThirdPartyPropName, ThirdPartyInstances>> = {};
  private disposed = false;

  private sample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private sample2: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  private quat = new THREE.Quaternion();
  private quatFlat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private matrix = new THREE.Matrix4();
  private color = new THREE.Color();

  private lastBuildS = Number.NEGATIVE_INFINITY;
  private lastBuildAt = 0;
  private lastDirection = -1;
  private lastQuality: Quality = 'medium';
  private lastStationKey = '';
  private wasActive = false;
  private quality: Quality = 'medium';

  constructor() {
    this.ballastTexture = makeBallastTexture();
    this.poolTexture = makePoolTexture();
    this.platformTexture = makePlatformTexture();
    this.wallTexture = makeWallTexture();
    this.tactileTexture = makeTactileTexture();

    // Profile winding points inward, so FrontSide shows the shell only from
    // inside the tunnel and culls it away in the overview.
    this.shellMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
    });
    this.ballastMat = new THREE.MeshLambertMaterial({ map: this.ballastTexture });
    this.railMat = new THREE.MeshBasicMaterial({ color: 0x99a3ab, toneMapped: false });
    this.capMat = new THREE.MeshBasicMaterial({
      color: 0x030507,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffe2b2, toneMapped: false });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: this.poolTexture,
      color: 0xffd9a2,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.platformMat = new THREE.MeshLambertMaterial({
      map: this.platformTexture,
      color: 0xe4e7e6,
      side: THREE.DoubleSide,
    });
    this.platformFaceMat = new THREE.MeshLambertMaterial({
      color: 0x4d585f,
      side: THREE.DoubleSide,
    });
    this.tactileMat = new THREE.MeshBasicMaterial({
      map: this.tactileTexture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.edgeMat = new THREE.MeshBasicMaterial({
      color: 0xf4f0d8,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.wallMat = new THREE.MeshLambertMaterial({
      map: this.wallTexture,
      color: 0xd8dedf,
      side: THREE.DoubleSide,
    });
    this.wallBaseMat = new THREE.MeshLambertMaterial({
      color: 0x34434b,
      side: THREE.DoubleSide,
    });
    this.ceilingMat = new THREE.MeshLambertMaterial({
      color: 0x68747b,
      side: THREE.DoubleSide,
    });
    this.lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.doorGlassMat = new THREE.MeshLambertMaterial({
      color: 0xa8d2dc,
      emissive: 0x10252c,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.doorFrameMat = new THREE.MeshLambertMaterial({ color: 0x89979f });
    this.benchMat = new THREE.MeshLambertMaterial({ color: 0x60717b });
    this.platformLightMat = new THREE.MeshBasicMaterial({ color: 0xe2f1ff, toneMapped: false });
    this.directionSignMat = new THREE.MeshBasicMaterial({
      map: makeDirectionSignTexture(),
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.shellMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.shellMat);
    this.ballastMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ballastMat);
    this.railMeshL = new THREE.Mesh(new THREE.BufferGeometry(), this.railMat);
    this.railMeshR = new THREE.Mesh(new THREE.BufferGeometry(), this.railMat);
    this.capMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.capMat);
    this.shellMesh.frustumCulled = false;
    this.ballastMesh.frustumCulled = false;
    this.railMeshL.frustumCulled = false;
    this.railMeshR.frustumCulled = false;
    this.capMesh.frustumCulled = false;

    const fixtureGeo = new THREE.BoxGeometry(0.72, 0.08, 1.9);
    this.fixtureMesh = new THREE.InstancedMesh(fixtureGeo, this.fixtureMat, 96);
    this.fixtureMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fixtureMesh.frustumCulled = false;
    this.fixtureMesh.count = 0;

    const poolGeo = new THREE.PlaneGeometry(13, 13);
    this.poolMesh = new THREE.InstancedMesh(poolGeo, this.poolMat, 96);
    this.poolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.poolMesh.frustumCulled = false;
    this.poolMesh.count = 0;

    this.doorGlassMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.055, 1.62, 2.82),
      this.doorGlassMat,
      48,
    );
    this.doorPostMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.13, 1.98, 0.13),
      this.doorFrameMat,
      52,
    );
    this.doorHeaderMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.16, 0.18, 2.96),
      this.lineMat,
      48,
    );
    this.doorMeetingMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.15, 1.72, 0.065),
      this.doorFrameMat,
      48,
    );
    this.doorSillMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.18, 0.14, 2.96),
      this.doorFrameMat,
      48,
    );
    this.columnMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.44, 3.95, 0.44),
      this.doorFrameMat,
      14,
    );
    this.columnBaseMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.62, 0.18, 0.62),
      this.doorFrameMat,
      14,
    );
    this.columnCapMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.68, 0.22, 0.68),
      this.ceilingMat,
      14,
    );
    this.columnBandMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.46, 0.26, 0.46),
      this.lineMat,
      14,
    );
    this.beamMesh = this.stationInstanced(
      new THREE.BoxGeometry(13.55, 0.28, 0.36),
      this.ceilingMat,
      14,
    );
    const conduitGeo = new THREE.CylinderGeometry(0.055, 0.055, 6.15, 6);
    conduitGeo.rotateX(Math.PI / 2);
    this.conduitMesh = this.stationInstanced(conduitGeo, this.doorFrameMat, 48);
    this.benchSeatMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.62, 0.12, 2.2),
      this.benchMat,
      8,
    );
    this.benchBackMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.12, 0.68, 2.2),
      this.benchMat,
      8,
    );
    this.benchLegMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.12, 0.48, 0.12),
      this.doorFrameMat,
      16,
    );
    this.benchArmMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.68, 0.08, 0.09),
      this.benchMat,
      16,
    );
    this.platformLightMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.44, 0.065, 2.5),
      this.platformLightMat,
      18,
    );
    this.wallLightMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.12, 0.12, 2.5),
      this.fixtureMat,
      18,
    );
    this.platformPoolMesh = this.stationInstanced(
      new THREE.PlaneGeometry(7.5, 7.5),
      this.poolMat,
      18,
    );
    this.directionBoardMesh = this.stationInstanced(
      new THREE.BoxGeometry(3.8, 0.9, 0.12),
      this.wallBaseMat,
      4,
    );
    this.signHangerMesh = this.stationInstanced(
      new THREE.BoxGeometry(0.06, 0.84, 0.06),
      this.doorFrameMat,
      8,
    );
    this.endWallMesh = this.stationInstanced(
      new THREE.BoxGeometry(5.9, 4.08, 0.24),
      this.wallMat,
      2,
    );
    this.endHeaderMesh = this.stationInstanced(
      new THREE.BoxGeometry(7.75, 0.82, 0.26),
      this.ceilingMat,
      2,
    );

    this.group.add(
      this.shellMesh,
      this.ballastMesh,
      this.railMeshL,
      this.railMeshR,
      this.capMesh,
      this.fixtureMesh,
      this.poolMesh,
      this.platformGroup,
      this.platformDetails,
      this.platformSigns,
      this.signalGroup,
    );
    this.group.visible = false;
    this.setQuality('medium');
    this.loadThirdPartyProps();
  }

  private loadThirdPartyProps(): void {
    const capacities: Record<ThirdPartyPropName, number> = {
      bench: 5,
      railing: 0,
      vending: 1,
      trash: 1,
      billboard: 0,
      exit: 2,
    };
    for (const name of UNDERGROUND_PROP_KEYS) {
      void loadThirdPartyProp(name, capacities[name]).then((prop) => {
        if (!prop) return;
        if (this.disposed) {
          prop.dispose();
          return;
        }
        this.thirdPartyProps[name] = prop;
        this.platformDetails.add(prop.group);
        this.lastBuildS = Number.NEGATIVE_INFINITY;
        this.lastStationKey = '';
      });
    }
  }

  private stationInstanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.stationInstances.push(mesh);
    this.platformDetails.add(mesh);
    return mesh;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.lastBuildS = Number.NEGATIVE_INFINITY;
  }

  update(
    geo: LineGeometry | null,
    s: number,
    direction: 0 | 1,
    active: boolean,
  ): void {
    if (!geo || !active) {
      this.group.visible = false;
      this.wasActive = false;
      return;
    }
    this.group.visible = true;
    const now = performance.now();
    const moved = Math.abs(s - this.lastBuildS);
    const changed =
      !this.wasActive ||
      direction !== this.lastDirection ||
      this.lastQuality !== this.quality ||
      moved > 18;
    if (!changed) return;
    if (this.wasActive && now - this.lastBuildAt < 180) return;
    this.wasActive = true;
    this.lastBuildS = s;
    this.lastDirection = direction;
    this.lastQuality = this.quality;
    this.lastBuildAt = now;
    this.rebuild(geo, s, direction);
  }

  private rebuild(geo: LineGeometry, s: number, direction: 0 | 1): void {
    const step = this.quality === 'high' ? 6.5 : this.quality === 'medium' ? 9.5 : 14;
    const lightSpacing = this.quality === 'high' ? 18 : this.quality === 'medium' ? 23 : 30;
    const ahead = this.quality === 'low' ? 280 : 360;
    const behind = 160;
    const winStart = direction === 0 ? s - behind : s - ahead;
    const winEnd = direction === 0 ? s + ahead : s + behind;

    const segments: Array<[number, number]> = [];
    for (const [a, b] of geo.tunnels) {
      const a0 = Math.max(a, winStart);
      const b0 = Math.min(b, winEnd);
      if (b0 - a0 > 6) segments.push([a0, b0]);
    }

    if (!segments.length) {
      this.setGeometry(this.shellMesh, null);
      this.setGeometry(this.ballastMesh, null);
      this.setGeometry(this.railMeshL, null);
      this.setGeometry(this.railMeshR, null);
      this.setGeometry(this.capMesh, null);
      this.fixtureMesh.count = 0;
      this.poolMesh.count = 0;
      this.clearPlatform();
      return;
    }

    const station = this.findStation(geo, s, direction);
    this.buildShell(geo, segments, step, lightSpacing, station);
    this.buildTrack(geo, segments, step);
    this.buildCap(geo, segments, direction);
    this.buildFixtures(geo, segments, lightSpacing);
    this.buildSignals(geo, segments, direction);
    this.buildStation(geo, station);
  }

  private buildShell(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    step: number,
    lightSpacing: number,
    station: StationContext | null,
  ): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let base = 0;

    for (const [a, b] of segments) {
      const sList = makeStepList(a, b, step);
      const rings = sList.length;
      if (rings < 2) continue;
      for (let ri = 0; ri < rings; ri++) {
        const sv = sList[ri];
        geo.sampleAt(sv, this.sample);
        const rx = -this.sample.tz;
        const rz = this.sample.tx;
        const lightPhase = ((sv % lightSpacing) + lightSpacing) % lightSpacing;
        const lightDist = Math.min(lightPhase, lightSpacing - lightPhase) / lightSpacing;
        const warm = Math.pow(Math.max(0, 1 - lightDist * 2.2), 3) * 0.11;
        for (let k = 0; k < PROFILE.length; k++) {
          const p = PROFILE[k];
          positions.push(
            this.sample.x + rx * p.lat,
            this.sample.y + p.y,
            this.sample.z + rz * p.lat,
          );
          const vertical = 0.032 + (Math.max(0, p.y + 1.15) / 6.5) * 0.052;
          colors.push(
            vertical + warm * 1.32,
            vertical + warm * 1.08,
            vertical + warm * 0.86,
          );
        }
      }
      for (let ri = 0; ri < rings - 1; ri++) {
        const rowA = base + ri * PROFILE.length;
        const rowB = rowA + PROFILE.length;
        const midS = (sList[ri] + sList[ri + 1]) * 0.5;
        const openPlatformSide =
          station !== null && midS >= station.range[0] && midS <= station.range[1];
        for (let k = 0; k < PROFILE.length - 1; k++) {
          // Remove only the platform half of the bored tube. The opposite wall
          // remains, while the wider local station enclosure replaces this side.
          if (openPlatformSide && (station.side > 0 ? k >= 4 : k <= 3)) continue;
          const a0 = rowA + k;
          const a1 = rowA + k + 1;
          const b0 = rowB + k;
          const b1 = rowB + k + 1;
          indices.push(a0, b0, a1, a1, b0, b1);
        }
      }

      // Floor slab closes the bottom of the horseshoe.
      const floorBase = base + rings * PROFILE.length;
      for (let ri = 0; ri < rings; ri++) {
        geo.sampleAt(sList[ri], this.sample);
        const rx = -this.sample.tz;
        const rz = this.sample.tx;
        positions.push(
          this.sample.x + rx * -4.5,
          this.sample.y - 1.15,
          this.sample.z + rz * -4.5,
        );
        positions.push(
          this.sample.x + rx * 4.5,
          this.sample.y - 1.15,
          this.sample.z + rz * 4.5,
        );
        colors.push(0.022, 0.025, 0.028, 0.022, 0.025, 0.028);
      }
      for (let ri = 0; ri < rings - 1; ri++) {
        const a0 = floorBase + ri * 2;
        const a1 = a0 + 1;
        const b0 = a0 + 2;
        const b1 = a0 + 3;
        indices.push(a0, a1, b0, a1, b1, b0);
      }
      base += rings * PROFILE.length + rings * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.setGeometry(this.shellMesh, geometry);
  }

  private buildTrack(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    step: number,
  ): void {
    const lane = 1.58;
    const ballast = buildStripGeometry(geo, segments, 0.18, 3.02, -0.48, step, 2.4, true);
    this.setGeometry(this.ballastMesh, ballast);
    this.setGeometry(
      this.railMeshL,
      buildStripGeometry(geo, segments, lane - 0.84, lane - 0.68, 0.02, step, undefined, true),
    );
    this.setGeometry(
      this.railMeshR,
      buildStripGeometry(geo, segments, lane + 0.68, lane + 0.84, 0.02, step, undefined, true),
    );
  }

  private buildCap(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    direction: 0 | 1,
  ): void {
    let farS = direction === 0 ? -Infinity : Infinity;
    for (const [a, b] of segments) {
      if (direction === 0) farS = Math.max(farS, b);
      else farS = Math.min(farS, a);
    }
    if (!Number.isFinite(farS)) {
      this.setGeometry(this.capMesh, null);
      return;
    }
    const beyond = farS + (direction === 0 ? 1.2 : -1.2);
    if (!geo.isInsideTunnel(beyond)) {
      this.setGeometry(this.capMesh, null);
      return;
    }
    geo.sampleAt(farS, this.sample);
    const rx = -this.sample.tz;
    const rz = this.sample.tx;
    const positions: number[] = [];
    const indices: number[] = [];
    for (const p of PROFILE) {
      positions.push(
        this.sample.x + rx * p.lat,
        this.sample.y + p.y,
        this.sample.z + rz * p.lat,
      );
    }
    positions.push(this.sample.x, this.sample.y + 2.1, this.sample.z);
    const center = PROFILE.length;
    for (let k = 0; k < PROFILE.length - 1; k++) {
      indices.push(center, k, k + 1);
    }
    indices.push(center, PROFILE.length - 1, 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.setGeometry(this.capMesh, geometry);
  }

  private buildFixtures(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    lightSpacing: number,
  ): void {
    let count = 0;
    this.quatFlat.setFromAxisAngle(X_AXIS, -Math.PI / 2);
    const capacity = this.fixtureMesh.instanceMatrix.count;
    for (const [a, b] of segments) {
      const first = Math.ceil(a / lightSpacing) * lightSpacing;
      for (let sv = first; sv <= b; sv += lightSpacing) {
        if (count >= capacity) break;
        geo.sampleAt(sv, this.sample);
        const yaw = Math.atan2(this.sample.tx, this.sample.tz);
        this.quat.setFromAxisAngle(UP, yaw);
        this.pos.set(this.sample.x, this.sample.y + 5.22, this.sample.z);
        this.matrix.compose(this.pos, this.quat, ONE);
        this.fixtureMesh.setMatrixAt(count, this.matrix);

        this.quat.multiply(this.quatFlat);
        this.pos.set(this.sample.x, this.sample.y - 0.4, this.sample.z);
        this.matrix.compose(this.pos, this.quat, this.scale.set(1, 1, 1));
        this.poolMesh.setMatrixAt(count, this.matrix);
        count++;
      }
    }
    this.fixtureMesh.count = count;
    this.poolMesh.count = count;
    this.fixtureMesh.instanceMatrix.needsUpdate = true;
    this.poolMesh.instanceMatrix.needsUpdate = true;
    this.fixtureMesh.visible = count > 0;
    this.poolMesh.visible = count > 0;
  }

  private buildSignals(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    direction: 0 | 1,
  ): void {
    clearChildren(this.signalGroup, false);
    const side = direction === 0 ? 1 : -1;
    for (const [a, b] of segments) {
      for (const sv of [a + 2.5, b - 2.5]) {
        if (!geo.isInsideTunnel(sv + (direction === 0 ? 0.8 : -0.8))) continue;
        geo.sampleAt(sv, this.sample);
        const rx = -this.sample.tz;
        const rz = this.sample.tx;
        const mesh = new THREE.Mesh(this.signalGeo, this.signalMat);
        mesh.position.set(
          this.sample.x + rx * (4.05 * side),
          this.sample.y + 1.9,
          this.sample.z + rz * (4.05 * side),
        );
        this.signalGroup.add(mesh);
      }
    }
  }

  private findStation(
    geo: LineGeometry,
    s: number,
    direction: 0 | 1,
  ): StationContext | null {
    let nearest: StationPoint | null = null;
    let best = 170;
    for (const station of geo.stations) {
      const distance = Math.abs(station.s - s);
      if (distance < best) {
        best = distance;
        nearest = station;
      }
    }
    if (!nearest) return null;
    for (const [a, b] of geo.tunnels) {
      if (nearest.s < a || nearest.s > b) continue;
      const range: [number, number] = [
        Math.max(a, nearest.s - 58),
        Math.min(b, nearest.s + 58),
      ];
      if (range[1] - range[0] < 26) return null;
      const side = direction === 0 ? 1 : -1;
      return {
        station: nearest,
        range,
        side,
        key: `${geo.line.id}:${nearest.id}:${direction}:${this.quality}`,
      };
    }
    return null;
  }

  private buildStation(geo: LineGeometry, context: StationContext | null): void {
    if (context?.key === this.lastStationKey) return;
    this.clearPlatform();
    if (!context) return;
    this.lastStationKey = context.key;

    const { station, range, side } = context;
    const latInner = 3.24;
    const latOuter = 9;
    const latWall = 9.14;
    const step = this.quality === 'high' ? 6.5 : this.quality === 'medium' ? 9 : 12;
    this.lineMat.color.set(geo.line.color);

    this.addStationSurface(
      buildStripGeometry(geo, [range], latInner * side, latOuter * side, 1.05, step, 2.8),
      this.platformMat,
    );
    this.addStationSurface(
      buildWallGeometry(geo, [range], latInner * side, -0.55, 1.05, step),
      this.platformFaceMat,
    );
    this.addStationSurface(
      buildStripGeometry(geo, [range], 3.38 * side, 3.48 * side, 1.066, step),
      this.edgeMat,
    );
    this.addStationSurface(
      buildStripGeometry(geo, [range], 3.58 * side, 4.02 * side, 1.072, step, 0.65),
      this.tactileMat,
    );
    this.addStationSurface(
      buildWallGeometry(geo, [range], latWall * side, -0.55, 1.05, step),
      this.wallBaseMat,
    );
    this.addStationSurface(
      buildWallGeometry(geo, [range], latWall * side, 1.05, 5.14, step, 3.2),
      this.wallMat,
    );
    this.addStationSurface(
      buildWallGeometry(geo, [range], 9.08 * side, 1.05, 1.24, step),
      this.wallBaseMat,
    );
    this.addStationSurface(
      buildWallGeometry(geo, [range], 9.1 * side, 2.62, 2.94, step),
      this.lineMat,
    );
    this.addStationSurface(
      buildStripGeometry(geo, [range], -4.55 * side, 9.2 * side, 5.14, step),
      this.ceilingMat,
    );
    // A recessed cable tray and two metal lips run above the platform wall.
    this.addStationSurface(
      buildStripGeometry(geo, [range], 8.38 * side, 8.82 * side, 4.58, step),
      this.ceilingMat,
    );
    for (const lat of [8.38, 8.82]) {
      this.addStationSurface(
        buildWallGeometry(geo, [range], lat * side, 4.43, 4.64, step),
        this.ceilingMat,
      );
    }

    // Full-height screen doors stay continuous at every quality level. Their
    // inner face is still outside the 2.94 m train body on the adjacent track.
    const doorLat = 3.28 * side;
    const moduleCount = Math.max(1, Math.floor((range[1] - range[0]) / 3));
    const margin = (range[1] - range[0] - moduleCount * 3) * 0.5;
    for (let i = 0; i < moduleCount; i++) {
      const sv = range[0] + margin + (i + 0.5) * 3;
      this.writeStation(this.doorGlassMesh, geo, sv, doorLat, 1.88);
      this.writeStation(this.doorHeaderMesh, geo, sv, doorLat, 2.96);
      this.writeStation(this.doorMeetingMesh, geo, sv, doorLat, 1.91);
      this.writeStation(this.doorSillMesh, geo, sv, doorLat, 1.13);
      this.writeStation(this.doorPostMesh, geo, sv - 1.5, doorLat, 2.04);
    }
    this.writeStation(
      this.doorPostMesh,
      geo,
      range[0] + margin + moduleCount * 3,
      doorLat,
      2.04,
    );

    const columnSpacing = this.quality === 'high' ? 11 : this.quality === 'medium' ? 16 : 22;
    const firstColumn = Math.ceil((range[0] + 4) / columnSpacing) * columnSpacing;
    for (let sv = firstColumn; sv <= range[1] - 4; sv += columnSpacing) {
      this.writeStation(this.columnMesh, geo, sv, 7.62 * side, 3.025);
      this.writeStation(this.columnBaseMesh, geo, sv, 7.62 * side, 1.14);
      this.writeStation(this.columnCapMesh, geo, sv, 7.62 * side, 4.94);
      this.writeStation(this.columnBandMesh, geo, sv, 7.62 * side, 2.78);
      this.writeStation(this.beamMesh, geo, sv, 2.3 * side, 5);
    }

    const conduitSpacing = this.quality === 'low' ? 8 : 6;
    for (let sv = range[0] + 3; sv <= range[1] - 3; sv += conduitSpacing) {
      this.writeStation(this.conduitMesh, geo, sv, 8.52 * side, 4.51);
      this.writeStation(this.conduitMesh, geo, sv, 8.70 * side, 4.51);
    }

    const benchOffsets =
      this.quality === 'high'
        ? [-40, -20, 0, 20, 40]
        : this.quality === 'medium'
          ? [-32, 0, 32]
          : [-28, 28];
    const bench = this.thirdPartyProps.bench;
    for (const offset of benchOffsets) {
      const sv = station.s + offset;
      if (sv < range[0] + 4 || sv > range[1] - 4) continue;
      if (bench) {
        this.writeThirdPartyProp(
          bench,
          geo,
          sv,
          8.18 * side,
          UNDERGROUND_PLATFORM_Y,
          side > 0 ? 0 : Math.PI,
        );
      } else {
        this.writeStation(this.benchSeatMesh, geo, sv, 8.18 * side, 1.57);
        this.writeStation(this.benchBackMesh, geo, sv, 8.51 * side, 1.91);
        this.writeStation(this.benchLegMesh, geo, sv - 0.72, 8.18 * side, 1.29);
        this.writeStation(this.benchLegMesh, geo, sv + 0.72, 8.18 * side, 1.29);
        this.writeStation(this.benchArmMesh, geo, sv - 0.9, 8.18 * side, 1.84);
        this.writeStation(this.benchArmMesh, geo, sv + 0.9, 8.18 * side, 1.84);
      }
    }
    this.addThirdPartyProps(geo, context);

    const lightSpacing = this.quality === 'high' ? 8.5 : this.quality === 'medium' ? 12 : 18;
    const firstLight = Math.ceil((range[0] + 3) / lightSpacing) * lightSpacing;
    for (let sv = firstLight; sv <= range[1] - 3; sv += lightSpacing) {
      this.writeStation(this.platformLightMesh, geo, sv, 6.1 * side, 4.8);
      this.writeStation(this.wallLightMesh, geo, sv, 8.96 * side, 4.30);
      this.writeStationPool(geo, sv, 6.1 * side, 1.078);
    }

    for (const sv of range) {
      this.writeStation(this.endWallMesh, geo, sv, 6.19 * side, 3.09);
      this.writeStation(this.endHeaderMesh, geo, sv, -0.63 * side, 4.72);
    }

    const directionOffsets =
      this.quality === 'high' ? [-30, 0, 30] : this.quality === 'medium' ? [-24, 24] : [0];
    for (const offset of directionOffsets) {
      const sv = station.s + offset;
      if (sv < range[0] + 4 || sv > range[1] - 4) continue;
      this.writeStation(this.directionBoardMesh, geo, sv, 6.05 * side, 3.74);
      this.writeStation(this.signHangerMesh, geo, sv, 4.85 * side, 4.61);
      this.writeStation(this.signHangerMesh, geo, sv, 7.25 * side, 4.61);
      for (const face of [-1, 1]) {
        geo.sampleAt(sv + face * 0.071, this.sample);
        const sign = new THREE.Mesh(this.directionSignGeo, this.directionSignMat);
        sign.position.set(
          this.sample.x - this.sample.tz * 6.05 * side,
          this.sample.y + 3.74,
          this.sample.z + this.sample.tx * 6.05 * side,
        );
        sign.rotation.y =
          Math.atan2(this.sample.tx, this.sample.tz) + (face < 0 ? Math.PI : 0);
        this.platformSigns.add(sign);
      }
    }

    const signOffsets =
      this.quality === 'high' ? [-36, 0, 36] : this.quality === 'medium' ? [-25, 25] : [0];
    const signMat = this.stationSign(station, geo.line);
    for (const offset of signOffsets) {
      const sv = station.s + offset;
      if (sv < range[0] + 4 || sv > range[1] - 4) continue;
      geo.sampleAt(sv, this.sample);
      const sign = new THREE.Mesh(this.signGeo, signMat);
      sign.position.set(
        this.sample.x - this.sample.tz * 9.055 * side,
        this.sample.y + 3.72,
        this.sample.z + this.sample.tx * 9.055 * side,
      );
      sign.rotation.y = Math.atan2(this.sample.tx, this.sample.tz) - side * Math.PI * 0.5;
      this.platformSigns.add(sign);
    }

    for (const mesh of this.stationInstances) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
    for (const name of UNDERGROUND_PROP_KEYS) this.thirdPartyProps[name]?.finish();
  }

  private addThirdPartyProps(geo: LineGeometry, context: StationContext): void {
    const { station, range, side } = context;
    const vending = this.thirdPartyProps.vending;
    const trash = this.thirdPartyProps.trash;
    const vendingS = station.s + 10;
    if (vending && vendingS >= range[0] + 4 && vendingS <= range[1] - 4) {
      this.writeThirdPartyProp(
        vending,
        geo,
        vendingS,
        8.45 * side,
        UNDERGROUND_PLATFORM_Y,
        side * Math.PI * 0.5,
      );
    }
    const trashS = station.s + 13;
    if (trash && trashS >= range[0] + 4 && trashS <= range[1] - 4) {
      this.writeThirdPartyProp(
        trash,
        geo,
        trashS,
        8.35 * side,
        UNDERGROUND_PLATFORM_Y,
      );
    }
    const exit = this.thirdPartyProps.exit;
    if (exit) {
      this.writeThirdPartyProp(
        exit,
        geo,
        range[0] + 0.16,
        6.19 * side,
        3.1,
        -Math.PI * 0.5,
      );
      this.writeThirdPartyProp(
        exit,
        geo,
        range[1] - 0.16,
        6.19 * side,
        3.1,
        Math.PI * 0.5,
      );
    }
  }

  private writeThirdPartyProp(
    prop: ThirdPartyInstances,
    geo: LineGeometry,
    sv: number,
    lat: number,
    yOffset: number,
    yaw = 0,
  ): void {
    geo.sampleAt(sv, this.sample);
    this.pos.set(
      this.sample.x - this.sample.tz * lat,
      this.sample.y + yOffset,
      this.sample.z + this.sample.tx * lat,
    );
    this.quat.setFromAxisAngle(UP, Math.atan2(this.sample.tx, this.sample.tz) + yaw);
    this.matrix.compose(this.pos, this.quat, ONE);
    prop.add(this.matrix);
  }

  private addStationSurface(
    geometry: THREE.BufferGeometry | null,
    material: THREE.Material,
  ): void {
    if (geometry) this.platformGroup.add(new THREE.Mesh(geometry, material));
  }

  private writeStation(
    mesh: THREE.InstancedMesh,
    geo: LineGeometry,
    sv: number,
    lat: number,
    yOffset: number,
  ): void {
    const index = mesh.count;
    if (index >= mesh.instanceMatrix.count) return;
    geo.sampleAt(sv, this.sample);
    this.pos.set(
      this.sample.x - this.sample.tz * lat,
      this.sample.y + yOffset,
      this.sample.z + this.sample.tx * lat,
    );
    this.quat.setFromAxisAngle(UP, Math.atan2(this.sample.tx, this.sample.tz));
    this.matrix.compose(this.pos, this.quat, ONE);
    mesh.setMatrixAt(index, this.matrix);
    mesh.count = index + 1;
  }

  private writeStationPool(geo: LineGeometry, sv: number, lat: number, yOffset: number): void {
    const index = this.platformPoolMesh.count;
    if (index >= this.platformPoolMesh.instanceMatrix.count) return;
    geo.sampleAt(sv, this.sample);
    this.pos.set(
      this.sample.x - this.sample.tz * lat,
      this.sample.y + yOffset,
      this.sample.z + this.sample.tx * lat,
    );
    this.quat.setFromAxisAngle(UP, Math.atan2(this.sample.tx, this.sample.tz));
    this.quatFlat.setFromAxisAngle(X_AXIS, -Math.PI / 2);
    this.quat.multiply(this.quatFlat);
    this.matrix.compose(this.pos, this.quat, ONE);
    this.platformPoolMesh.setMatrixAt(index, this.matrix);
    this.platformPoolMesh.count = index + 1;
  }

  private stationSign(
    station: StationPoint,
    line: LineGeometry['line'],
  ): THREE.MeshBasicMaterial {
    const key = `${line.id}:${station.id}`;
    const cached = this.signCache.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#edf2f3';
      ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = line.color;
      ctx.fillRect(0, 0, 1024, 20);
      ctx.fillRect(0, 20, 158, 236);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 72px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(line.ref, 79, 101, 136);
      ctx.font = '600 25px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(line.name, 79, 184, 138);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#12242d';
      ctx.font = '700 82px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(station.name, 194, 110, 776);
      ctx.fillStyle = '#526a75';
      ctx.font = '500 29px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('站台  PLATFORM', 198, 202);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.signCache.set(key, material);
    return material;
  }

  private setGeometry(
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
    geometry: THREE.BufferGeometry | null,
  ): void {
    if (mesh.geometry) mesh.geometry.dispose();
    if (geometry) {
      mesh.geometry = geometry;
      mesh.visible = true;
    } else {
      mesh.geometry = new THREE.BufferGeometry();
      mesh.visible = false;
    }
  }

  private clearPlatform(): void {
    clearChildren(this.platformGroup, true);
    clearChildren(this.platformSigns, false);
    for (const mesh of this.stationInstances) {
      mesh.count = 0;
      mesh.visible = false;
    }
    for (const name of UNDERGROUND_PROP_KEYS) this.thirdPartyProps[name]?.reset();
    this.lastStationKey = '';
  }

  dispose(): void {
    this.disposed = true;
    for (const name of UNDERGROUND_PROP_KEYS) this.thirdPartyProps[name]?.dispose();
    for (const material of this.signCache.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.signCache.clear();
    this.ballastTexture.dispose();
    this.poolTexture.dispose();
    this.platformTexture.dispose();
    this.wallTexture.dispose();
    this.tactileTexture.dispose();
    this.shellMat.dispose();
    this.ballastMat.dispose();
    this.railMat.dispose();
    this.capMat.dispose();
    this.fixtureMat.dispose();
    this.poolMat.dispose();
    this.platformMat.dispose();
    this.platformFaceMat.dispose();
    this.tactileMat.dispose();
    this.edgeMat.dispose();
    this.wallMat.dispose();
    this.wallBaseMat.dispose();
    this.ceilingMat.dispose();
    this.lineMat.dispose();
    this.doorGlassMat.dispose();
    this.doorFrameMat.dispose();
    this.benchMat.dispose();
    this.platformLightMat.dispose();
    this.directionSignMat.map?.dispose();
    this.directionSignMat.dispose();
    this.signalMat.dispose();
    this.signalGeo.dispose();
    this.signGeo.dispose();
    this.directionSignGeo.dispose();
    this.shellMesh.geometry.dispose();
    this.ballastMesh.geometry.dispose();
    this.railMeshL.geometry.dispose();
    this.railMeshR.geometry.dispose();
    this.capMesh.geometry.dispose();
    this.fixtureMesh.geometry.dispose();
    this.fixtureMesh.dispose();
    this.poolMesh.geometry.dispose();
    this.poolMesh.dispose();
    for (const mesh of this.stationInstances) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    clearChildren(this.platformGroup, true);
    clearChildren(this.platformSigns, false);
    clearChildren(this.signalGroup, false);
  }
}

function clearChildren(group: THREE.Group, disposeGeometry: boolean): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (!(child instanceof THREE.Mesh)) continue;
    if (disposeGeometry) child.geometry.dispose();
    if (!child.userData.ownMaterial) continue;
    const material = child.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}

function makeStepList(a: number, b: number, step: number): number[] {
  const length = b - a;
  const count = Math.max(2, Math.ceil(length / step) + 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === count - 1 ? b : a + (length * i) / (count - 1));
  }
  return out;
}

function buildStripGeometry(
  geo: LineGeometry,
  segments: Array<[number, number]>,
  latA: number,
  latB: number,
  yOffset: number,
  step: number,
  uvScale?: number,
  mirrored = false,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;
  const sample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  const spans: Array<[number, number]> = mirrored
    ? [[-latB, -latA], [latA, latB]]
    : [[latA, latB]];
  for (const [a, b] of segments) {
    const sList = makeStepList(a, b, step);
    if (sList.length < 2) continue;
    for (const [spanA, spanB] of spans) {
      for (const sv of sList) {
        geo.sampleAt(sv, sample);
        const rx = -sample.tz;
        const rz = sample.tx;
        for (const lat of [spanA, spanB]) {
          positions.push(sample.x + rx * lat, sample.y + yOffset, sample.z + rz * lat);
        }
        if (uvScale) {
          uvs.push(0, sv / uvScale, 1, sv / uvScale);
        }
      }
      const rings = sList.length;
      for (let i = 0; i < rings - 1; i++) {
        const a0 = base + i * 2;
        const a1 = a0 + 1;
        const b0 = a0 + 2;
        const b1 = a0 + 3;
        indices.push(a0, a1, b0, a1, b1, b0);
      }
      base += rings * 2;
    }
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (uvScale) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildWallGeometry(
  geo: LineGeometry,
  segments: Array<[number, number]>,
  lat: number,
  yBottom: number,
  yTop: number,
  step: number,
  uvScale?: number,
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;
  const sample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  for (const [a, b] of segments) {
    const sList = makeStepList(a, b, step);
    if (sList.length < 2) continue;
    for (const sv of sList) {
      geo.sampleAt(sv, sample);
      const rx = -sample.tz;
      const rz = sample.tx;
      positions.push(
        sample.x + rx * lat,
        sample.y + yBottom,
        sample.z + rz * lat,
        sample.x + rx * lat,
        sample.y + yTop,
        sample.z + rz * lat,
      );
      if (uvScale) {
        uvs.push(sv / uvScale, yBottom / uvScale, sv / uvScale, yTop / uvScale);
      }
    }
    const rings = sList.length;
    for (let i = 0; i < rings - 1; i++) {
      const a0 = base + i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, a1, b0, a1, b1, b0);
    }
    base += rings * 2;
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (uvScale) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeDirectionSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext?.('2d');
  if (ctx) {
    ctx.fillStyle = '#17313d';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#f2f7f7';
    ctx.textBaseline = 'middle';
    ctx.font = '700 82px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('←', 34, 116);
    ctx.font = '700 61px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('出入口', 142, 99);
    ctx.fillStyle = '#b9cbd2';
    ctx.font = '600 31px Arial, sans-serif';
    ctx.fillText('EXIT', 148, 177);
    ctx.strokeStyle = '#66818d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(512, 34);
    ctx.lineTo(512, 222);
    ctx.stroke();
    ctx.fillStyle = '#f2f7f7';
    ctx.font = '700 61px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('乘车', 566, 99);
    ctx.fillStyle = '#b9cbd2';
    ctx.font = '600 31px Arial, sans-serif';
    ctx.fillText('TRAINS', 570, 177);
    ctx.fillStyle = '#f2f7f7';
    ctx.font = '700 82px Arial, sans-serif';
    ctx.fillText('→', 866, 116);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeBallastTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#171a1d';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const v = 24 + Math.random() * 34;
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 3})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.fillStyle = '#34383b';
    ctx.fillRect(0, 42, 128, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(0, 42, 128, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePlatformTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#aeb6b7';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 6; x++) {
        const shade = 190 + ((x * 7 + y * 11) % 12);
        ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 3})`;
        ctx.fillRect(x * 43 + 1, y * 64 + 1, 41, 62);
      }
    }
    ctx.fillStyle = 'rgba(70,80,82,0.14)';
    for (let i = 0; i < 90; i++) {
      ctx.fillRect((i * 47) % 256, (i * 83) % 256, 1, 1);
    }
  }
  return tiledTexture(canvas);
}

function makeWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#c9d0d1';
    ctx.fillRect(0, 0, 128, 128);
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.02)');
    gradient.addColorStop(1, 'rgba(40,55,60,0.13)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(68,83,88,0.36)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 126, 126);
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, 128);
    ctx.stroke();
  }
  return tiledTexture(canvas);
}

function makeTactileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#d9a827';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#f0c84d';
    for (let y = 6; y < 64; y += 13) {
      for (let x = 6; x < 64; x += 13) {
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(105,73,10,0.32)';
    ctx.strokeRect(0.5, 0.5, 63, 63);
  }
  return tiledTexture(canvas);
}

function tiledTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makePoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(255,226,178,0.95)');
    gradient.addColorStop(0.45, 'rgba(255,214,158,0.38)');
    gradient.addColorStop(1, 'rgba(255,196,130,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
