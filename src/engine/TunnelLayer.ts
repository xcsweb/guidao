import * as THREE from 'three';
import type { Quality } from '@/state/store';
import type { LineGeometry, PathSample, StationPoint } from './LineGeometry';

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

interface ProfilePoint {
  lat: number;
  y: number;
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
  private signalGroup = new THREE.Group();

  private shellMat: THREE.MeshBasicMaterial;
  private ballastMat: THREE.MeshLambertMaterial;
  private railMat: THREE.MeshBasicMaterial;
  private capMat: THREE.MeshBasicMaterial;
  private fixtureMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private platformMat: THREE.MeshLambertMaterial;
  private tactileMat: THREE.MeshBasicMaterial;
  private benchMat: THREE.MeshLambertMaterial;
  private platformLightMat: THREE.MeshBasicMaterial;
  private signalMat = new THREE.MeshBasicMaterial({ color: 0x8ef3a6, toneMapped: false });
  private signalGeo = new THREE.SphereGeometry(0.18, 8, 6);

  private ballastTexture: THREE.CanvasTexture;
  private poolTexture: THREE.CanvasTexture;
  private signCache = new Map<string, THREE.CanvasTexture>();

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
    const ballastTexture = makeBallastTexture();
    this.ballastTexture = ballastTexture;
    this.poolTexture = makePoolTexture();

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
      color: 0xb2b9bd,
      side: THREE.DoubleSide,
    });
    this.tactileMat = new THREE.MeshBasicMaterial({
      color: 0xe7b53a,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.benchMat = new THREE.MeshLambertMaterial({ color: 0x646d73 });
    this.platformLightMat = new THREE.MeshBasicMaterial({ color: 0xd6e9ff, toneMapped: false });

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

    this.group.add(
      this.shellMesh,
      this.ballastMesh,
      this.railMeshL,
      this.railMeshR,
      this.capMesh,
      this.fixtureMesh,
      this.poolMesh,
      this.platformGroup,
      this.signalGroup,
    );
    this.group.visible = false;
    this.setQuality('medium');
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

    this.buildShell(geo, segments, step, lightSpacing);
    this.buildTrack(geo, segments, step);
    this.buildCap(geo, segments, direction);
    this.buildFixtures(geo, segments, lightSpacing);
    this.buildSignals(geo, segments, direction);
    this.buildStation(geo, s, direction);
  }

  private buildShell(
    geo: LineGeometry,
    segments: Array<[number, number]>,
    step: number,
    lightSpacing: number,
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
        for (let k = 0; k < PROFILE.length - 1; k++) {
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

  private buildStation(geo: LineGeometry, s: number, direction: 0 | 1): void {
    let nearest: StationPoint | null = null;
    let best = 170;
    for (const station of geo.stations) {
      const d = Math.abs(station.s - s);
      if (d < best) {
        best = d;
        nearest = station;
      }
    }
    let range: [number, number] | null = null;
    if (nearest) {
      for (const [a, b] of geo.tunnels) {
        if (nearest.s >= a && nearest.s <= b) {
          range = [Math.max(a, nearest.s - 58), Math.min(b, nearest.s + 58)];
          break;
        }
      }
    }
    const key =
      nearest && range ? `${geo.line.id}:${nearest.id}:${direction}` : '';
    if (key === this.lastStationKey) return;
    this.clearPlatform();
    this.lastStationKey = key;
    if (!nearest || !range || range[1] - range[0] < 26) return;

    const side = direction === 0 ? 1 : -1;
    const latInner = 3.22;
    const latOuter = 4.38;
    const step = this.quality === 'high' ? 6.5 : 10;
    const platform = buildStripGeometry(
      geo,
      [range],
      latInner * side,
      latOuter * side,
      1.03,
      step,
    );
    if (!platform) return;
    const platformMesh = new THREE.Mesh(platform, this.platformMat);
    this.platformGroup.add(platformMesh);

    const tactile = buildStripGeometry(
      geo,
      [range],
      latInner * side,
      (latInner + 0.42) * side,
      1.07,
      step,
    );
    if (tactile) {
      this.platformGroup.add(new THREE.Mesh(tactile, this.tactileMat));
    }

    const wall = buildWallGeometry(
      geo,
      [range],
      latInner * side,
      -0.55,
      1.03,
      step,
    );
    if (wall) {
      this.platformGroup.add(new THREE.Mesh(wall, this.platformMat));
    }

    const benchGeo = new THREE.BoxGeometry(0.55, 0.12, 1.9);
    for (let i = -2; i <= 2; i++) {
      const sv = nearest.s + i * 21;
      if (sv < range[0] || sv > range[1]) continue;
      geo.sampleAt(sv, this.sample);
      const yaw = Math.atan2(this.sample.tx, this.sample.tz);
      const bench = new THREE.Mesh(benchGeo, this.benchMat);
      const rx = -this.sample.tz;
      const rz = this.sample.tx;
      bench.position.set(
        this.sample.x + rx * 4.02 * side,
        this.sample.y + 1.62,
        this.sample.z + rz * 4.02 * side,
      );
      bench.rotation.y = yaw;
      this.platformGroup.add(bench);
    }

    const lightGeo = new THREE.BoxGeometry(0.5, 0.05, 1.5);
    for (let i = -2; i <= 2; i++) {
      const sv = nearest.s + i * 22;
      if (sv < range[0] || sv > range[1]) continue;
      geo.sampleAt(sv, this.sample);
      const yaw = Math.atan2(this.sample.tx, this.sample.tz);
      const light = new THREE.Mesh(lightGeo, this.platformLightMat);
      const rx = -this.sample.tz;
      const rz = this.sample.tx;
      light.position.set(
        this.sample.x + rx * 3.9 * side,
        this.sample.y + 4.1,
        this.sample.z + rz * 3.9 * side,
      );
      light.rotation.y = yaw;
      this.platformGroup.add(light);
    }

    const signS = nearest.s + (direction === 0 ? -30 : 30);
    if (signS >= range[0] && signS <= range[1]) {
      const texture = this.stationSign(nearest, geo.line.color);
      const signMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        toneMapped: false,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), signMat);
      geo.sampleAt(signS, this.sample);
      const yaw = Math.atan2(this.sample.tx, this.sample.tz) + (direction === 0 ? Math.PI : 0);
      const rx = -this.sample.tz;
      const rz = this.sample.tx;
      sign.position.set(
        this.sample.x + rx * 3.88 * side,
        this.sample.y + 3.55,
        this.sample.z + rz * 3.88 * side,
      );
      sign.rotation.y = yaw;
      sign.userData.ownMaterial = true;
      this.platformGroup.add(sign);
    }
  }

  private stationSign(station: StationPoint, color: string): THREE.CanvasTexture {
    const key = `${station.id}-${color}`;
    const cached = this.signCache.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#08131c';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 16, 128);
      ctx.strokeStyle = 'rgba(190, 230, 240, 0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 6, 490, 116);
      ctx.fillStyle = '#f2fbff';
      ctx.font = '600 50px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(station.name, 44, 54, 440);
      ctx.fillStyle = 'rgba(168, 205, 220, 0.72)';
      ctx.font = '500 21px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('站台 · PLATFORM', 46, 98);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.signCache.set(key, texture);
    return texture;
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
    this.lastStationKey = '';
  }

  dispose(): void {
    for (const texture of this.signCache.values()) texture.dispose();
    this.signCache.clear();
    this.ballastTexture.dispose();
    this.poolTexture.dispose();
    this.shellMat.dispose();
    this.ballastMat.dispose();
    this.railMat.dispose();
    this.capMat.dispose();
    this.fixtureMat.dispose();
    this.poolMat.dispose();
    this.platformMat.dispose();
    this.tactileMat.dispose();
    this.benchMat.dispose();
    this.platformLightMat.dispose();
    this.signalMat.dispose();
    this.signalGeo.dispose();
    this.shellMesh.geometry.dispose();
    this.ballastMesh.geometry.dispose();
    this.railMeshL.geometry.dispose();
    this.railMeshR.geometry.dispose();
    this.capMesh.geometry.dispose();
    this.fixtureMesh.geometry.dispose();
    this.fixtureMesh.dispose();
    this.poolMesh.geometry.dispose();
    this.poolMesh.dispose();
    clearChildren(this.platformGroup, true);
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
): THREE.BufferGeometry | null {
  const positions: number[] = [];
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
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
