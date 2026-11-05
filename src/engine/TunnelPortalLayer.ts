import * as THREE from 'three';
import type { Quality } from '@/state/store';
import type { LineGeometry, PathSample } from './LineGeometry';
import { RailCorridor, type TunnelPortal } from './RailCorridor';

interface PortalProfilePoint {
  lat: number;
  y: number;
}

interface ActivePortal {
  group: THREE.Group;
  ownedGeometry: THREE.BufferGeometry;
}

const INNER_PROFILE: PortalProfilePoint[] = [
  { lat: -4.65, y: -1.05 },
  { lat: -4.65, y: 1.95 },
  { lat: -4.12, y: 3.55 },
  { lat: -2.55, y: 4.95 },
  { lat: 0, y: 5.55 },
  { lat: 2.55, y: 4.95 },
  { lat: 4.12, y: 3.55 },
  { lat: 4.65, y: 1.95 },
  { lat: 4.65, y: -1.05 },
];

const OUTER_PROFILE: PortalProfilePoint[] = [
  { lat: -6.25, y: -1.3 },
  { lat: -6.25, y: 2.2 },
  { lat: -5.55, y: 4.35 },
  { lat: -3.45, y: 6.25 },
  { lat: 0, y: 6.95 },
  { lat: 3.45, y: 6.25 },
  { lat: 5.55, y: 4.35 },
  { lat: 6.25, y: 2.2 },
  { lat: 6.25, y: -1.3 },
];

const QUALITY_SETTINGS: Record<Quality, { distance: number; maxPortals: number; step: number }> = {
  low: { distance: 1500, maxPortals: 6, step: 10 },
  medium: { distance: 2300, maxPortals: 10, step: 7 },
  high: { distance: 3200, maxPortals: 12, step: 4.5 },
};

/** Near-camera portal sets. Frame resources are shared; only short bores are lazy. */
export class TunnelPortalLayer {
  readonly group = new THREE.Group();

  private corridor: RailCorridor;
  private geometries: Map<string, LineGeometry>;
  private active = new Map<string, ActivePortal>();
  private quality: Quality = 'medium';
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private frameGeometry: THREE.BufferGeometry;
  private boxGeometry: THREE.BoxGeometry;
  private concreteMaterial: THREE.MeshLambertMaterial;
  private interiorMaterial: THREE.MeshBasicMaterial;
  private sample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

  constructor(corridor: RailCorridor, geometries: Map<string, LineGeometry>) {
    this.corridor = corridor;
    this.geometries = geometries;
    this.group.name = 'tunnel-portals';
    this.frameGeometry = buildFrameGeometry();
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.concreteMaterial = new THREE.MeshLambertMaterial({
      color: 0x8b8c86,
      side: THREE.DoubleSide,
    });
    this.interiorMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  get activeCount(): number {
    return this.active.size;
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.clearActive();
    this.lastX = Number.NaN;
    this.lastZ = Number.NaN;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (
      Number.isFinite(this.lastX)
      && Math.hypot(camera.position.x - this.lastX, camera.position.z - this.lastZ) < 56
    ) return;
    this.lastX = camera.position.x;
    this.lastZ = camera.position.z;
    const settings = QUALITY_SETTINGS[this.quality];
    const nearby = this.corridor.portalsNear(
      camera.position.x,
      camera.position.z,
      settings.distance,
    ).slice(0, settings.maxPortals);
    const wanted = new Set(nearby.map((portal) => portal.id));

    for (const [id, active] of this.active) {
      if (wanted.has(id)) continue;
      this.group.remove(active.group);
      active.ownedGeometry.dispose();
      this.active.delete(id);
    }
    for (const portal of nearby) {
      if (this.active.has(portal.id)) continue;
      const active = this.buildPortal(portal);
      this.active.set(portal.id, active);
      this.group.add(active.group);
    }
  }

  private buildPortal(portal: TunnelPortal): ActivePortal {
    const fx = portal.tx * portal.inward;
    const fz = portal.tz * portal.inward;
    const yaw = Math.atan2(fx, fz);
    const root = new THREE.Group();
    root.name = `portal:${portal.id}`;
    root.position.set(portal.x, portal.y, portal.z);
    root.rotation.y = yaw;

    const frame = new THREE.Mesh(this.frameGeometry, this.concreteMaterial);
    frame.name = 'lining-and-headwall';
    root.add(frame);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(this.boxGeometry, this.concreteMaterial);
      wing.name = 'wing-wall';
      wing.position.set(side * 6.45, 1.35, -7.1);
      wing.scale.set(0.72, 5.5, 15.5);
      wing.rotation.y = side * -0.17;
      root.add(wing);
    }

    const ownedGeometry = this.buildInterior(portal, yaw);
    const interior = new THREE.Mesh(ownedGeometry, this.interiorMaterial);
    interior.name = 'short-bore';
    root.add(interior);
    return { group: root, ownedGeometry };
  }

  private buildInterior(portal: TunnelPortal, yaw: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const geo = this.geometries.get(portal.lineId);
    if (!geo) return new THREE.BufferGeometry();

    const depth = Math.max(1.5, portal.interiorDepth - 0.65);
    const step = QUALITY_SETTINGS[this.quality].step;
    const rings = Math.max(2, Math.ceil(depth / step) + 1);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const centers: Array<[number, number, number]> = [];

    for (let ring = 0; ring < rings; ring++) {
      const localDepth = 0.65 + (depth * ring) / (rings - 1);
      const s = portal.s + portal.inward * localDepth;
      geo.sampleAt(s, this.sample);
      const dx = this.sample.x - portal.x;
      const dz = this.sample.z - portal.z;
      const cx = cos * dx - sin * dz;
      const cz = sin * dx + cos * dz;
      const cy = this.sample.y - portal.y;
      centers.push([cx, cy, cz]);
      const shade = 1 - (ring / Math.max(1, rings - 1)) * 0.78;
      for (const point of INNER_PROFILE) {
        positions.push(cx + point.lat, cy + point.y, cz);
        colors.push(0.135 * shade, 0.14 * shade, 0.135 * shade);
      }
    }

    const profileCount = INNER_PROFILE.length;
    for (let ring = 0; ring < rings - 1; ring++) {
      const a = ring * profileCount;
      const b = a + profileCount;
      for (let k = 0; k < profileCount - 1; k++) {
        indices.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      }
    }

    // Ballast/invert and four rail heads continue the track into the dark bore.
    let base = rings * profileCount;
    for (let ring = 0; ring < rings; ring++) {
      const [cx, cy, cz] = centers[ring];
      positions.push(cx - 4.5, cy - 0.5, cz, cx + 4.5, cy - 0.5, cz);
      colors.push(0.032, 0.034, 0.033, 0.032, 0.034, 0.033);
    }
    for (let ring = 0; ring < rings - 1; ring++) {
      const a = base + ring * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    const railSpans = [-2.52, -2.4, -0.9, -0.74, 0.74, 0.9, 2.4, 2.52];
    for (let pair = 0; pair < railSpans.length; pair += 2) {
      base = positions.length / 3;
      const latA = railSpans[pair];
      const latB = railSpans[pair + 1];
      for (const [cx, cy, cz] of centers) {
        positions.push(cx + latA, cy + 0.02, cz, cx + latB, cy + 0.02, cz);
        colors.push(0.25, 0.27, 0.28, 0.25, 0.27, 0.28);
      }
      for (let ring = 0; ring < rings - 1; ring++) {
        const a = base + ring * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    // A recessed cap supplies an unambiguous short depth cue without opening
    // any terrain along the rest of the tunnel.
    base = positions.length / 3;
    const [capX, capY, capZ] = centers[centers.length - 1];
    for (const point of INNER_PROFILE) {
      positions.push(capX + point.lat, capY + point.y, capZ + 0.02);
      colors.push(0.003, 0.004, 0.004);
    }
    const centerIndex = positions.length / 3;
    positions.push(capX, capY + 1.9, capZ + 0.02);
    colors.push(0.003, 0.004, 0.004);
    for (let k = 0; k < profileCount; k++) {
      indices.push(centerIndex, base + k, base + ((k + 1) % profileCount));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private clearActive(): void {
    for (const active of this.active.values()) {
      this.group.remove(active.group);
      active.ownedGeometry.dispose();
    }
    this.active.clear();
  }

  dispose(): void {
    this.clearActive();
    this.frameGeometry.dispose();
    this.boxGeometry.dispose();
    this.concreteMaterial.dispose();
    this.interiorMaterial.dispose();
  }
}

function buildFrameGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = INNER_PROFILE.length;
  for (const z of [-0.7, 0.7]) {
    for (const profile of [OUTER_PROFILE, INNER_PROFILE]) {
      for (const point of profile) positions.push(point.lat, point.y, z);
    }
  }
  const ringStride = count * 2;
  for (let side = 0; side < 2; side++) {
    const base = side * ringStride;
    for (let i = 0; i < count - 1; i++) {
      const outerA = base + i;
      const outerB = outerA + 1;
      const innerA = base + count + i;
      const innerB = innerA + 1;
      indices.push(outerA, outerB, innerA, outerB, innerB, innerA);
    }
  }
  for (let i = 0; i < count - 1; i++) {
    const outerA = i;
    const outerB = i + 1;
    const outerBackA = ringStride + i;
    const outerBackB = outerBackA + 1;
    indices.push(outerA, outerBackA, outerB, outerB, outerBackA, outerBackB);
    const innerA = count + i;
    const innerB = innerA + 1;
    const innerBackA = ringStride + count + i;
    const innerBackB = innerBackA + 1;
    indices.push(innerA, innerB, innerBackA, innerB, innerBackB, innerBackA);
  }
  // Close the sill between the two bottom endpoints.
  indices.push(0, count, ringStride, count, ringStride + count, ringStride);
  indices.push(count - 1, ringStride + count - 1, count * 2 - 1, count * 2 - 1, ringStride + count - 1, ringStride + count * 2 - 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
