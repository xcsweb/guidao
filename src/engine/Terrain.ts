import * as THREE from 'three';
import type { CityManifest, TerrainMeta } from '@/data/types';
import type { Quality } from '@/state/store';
import { Projection } from './Projection';
import {
  PORTAL_HOLE_AHEAD,
  PORTAL_HOLE_BACK,
  PORTAL_HOLE_HALF_WIDTH,
  type RailCorridor,
} from './RailCorridor';

interface TierRuntime {
  meta: TerrainMeta['tiers'][number];
  data: Int16Array;
  bounds: [number, number, number, number];
  resolution: number;
}

interface ChunkNode {
  key: string;
  level: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  children: ChunkNode[] | null;
  mesh: THREE.Mesh | null;
  lastUsed: number;
}

const QUALITY_SETTINGS: Record<Quality, {
  segments: number;
  maxChunks: number;
  maxLevel: number;
  threshold: number;
  corridorCell: number;
  corridorDistance: number;
}> = {
  low: { segments: 8, maxChunks: 110, maxLevel: 8, threshold: 360, corridorCell: 18, corridorDistance: 1500 },
  medium: { segments: 14, maxChunks: 220, maxLevel: 11, threshold: 230, corridorCell: 12, corridorDistance: 2300 },
  high: { segments: 20, maxChunks: 320, maxLevel: 12, threshold: 200, corridorCell: 8, corridorDistance: 3200 },
};

const MAX_PORTAL_OPENINGS = 12;

const ELEVATION_STOPS: Array<[number, string]> = [
  [140, '#2f4a3e'],
  [220, '#385240'],
  [320, '#425b41'],
  [450, '#4b6243'],
  [650, '#576947'],
  [900, '#646b4e'],
  [1300, '#726e55'],
  [1800, '#7f7864'],
  [2400, '#908774'],
];

const ROCK_COLOR = new THREE.Color('#6f6454');

function colorForHeight(h: number): THREE.Color {
  for (let i = 1; i < ELEVATION_STOPS.length; i++) {
    if (h <= ELEVATION_STOPS[i][0]) {
      const a = ELEVATION_STOPS[i - 1];
      const b = ELEVATION_STOPS[i];
      const t = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0])));
      return new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), t);
    }
  }
  return new THREE.Color(ELEVATION_STOPS[ELEVATION_STOPS.length - 1][1]);
}

export class TerrainSystem {
  readonly group = new THREE.Group();
  readonly projection: Projection;
  private tiers: TierRuntime[] = [];
  private quality: Quality = 'medium';
  private root: ChunkNode;
  private cache = new Map<string, ChunkNode>();
  private material: THREE.MeshLambertMaterial;
  private viewportHeight = 900;
  private fovTan = Math.tan((55 * Math.PI) / 180 / 2);
  private visibleCount = 0;
  private maxLevel = 10;
  private segments = 14;
  private threshold = 260;
  private maxChunks = 120;
  private heightScale = 1;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private corridor: RailCorridor | null = null;
  private portalCountUniform = { value: 0 };
  private portalUniforms = {
    value: Array.from({ length: MAX_PORTAL_OPENINGS }, () => new THREE.Vector4()),
  };
  private portalAnchorX = Number.NaN;
  private portalAnchorZ = Number.NaN;

  constructor(manifest: CityManifest, meta: TerrainMeta, buffers: Int16Array[]) {
    this.projection = new Projection(manifest);
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uPortalCount = this.portalCountUniform;
      shader.uniforms.uPortals = this.portalUniforms;
      shader.vertexShader = `varying vec3 vTerrainWorld;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = `
        varying vec3 vTerrainWorld;
        uniform int uPortalCount;
        uniform vec4 uPortals[${MAX_PORTAL_OPENINGS}];
        ${shader.fragmentShader}
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        for (int i = 0; i < ${MAX_PORTAL_OPENINGS}; i++) {
          if (i >= uPortalCount) continue;
          vec2 delta = vTerrainWorld.xz - uPortals[i].xy;
          vec2 forward = uPortals[i].zw;
          float along = dot(delta, forward);
          float lateral = dot(delta, vec2(-forward.y, forward.x));
          if (along > -${PORTAL_HOLE_BACK.toFixed(1)} && along < ${PORTAL_HOLE_AHEAD.toFixed(1)}
            && abs(lateral) < ${PORTAL_HOLE_HALF_WIDTH.toFixed(2)}) discard;
        }`,
      );
    };
    this.material.customProgramCacheKey = () => 'terrain-rail-corridor-v1';

    meta.tiers.forEach((tier, i) => {
      const [lonMin, latMin, lonMax, latMax] = tier.bbox;
      const a = this.projection.toLocal(lonMin, latMax);
      const b = this.projection.toLocal(lonMax, latMin);
      this.tiers.push({
        meta: tier,
        data: buffers[i],
        bounds: [a[0], a[1], b[0], b[1]],
        resolution: Math.min(tier.resolutionX, tier.resolutionZ),
      });
    });
    this.tiers.sort((x, y) => x.resolution - y.resolution);

    const size = Math.max(...this.tiers.map((t) => Math.max(t.bounds[2] - t.bounds[0], t.bounds[3] - t.bounds[1])));
    const cx = (manifest.boundsLocal[0] + manifest.boundsLocal[2]) / 2;
    const cz = (manifest.boundsLocal[1] + manifest.boundsLocal[3]) / 2;
    const half = size * 0.56;
    this.root = {
      key: 'root',
      level: 0,
      x0: cx - half,
      z0: cz - half,
      x1: cx + half,
      z1: cz + half,
      children: null,
      mesh: null,
      lastUsed: 0,
    };
    this.applyQuality('medium');
  }

  get visibleChunks(): number {
    return this.visibleCount;
  }

  setViewport(height: number, fovDeg: number): void {
    this.viewportHeight = height;
    this.fovTan = Math.tan((fovDeg * Math.PI) / 180 / 2);
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.applyQuality(quality);
  }

  setHeightScale(scale: number): void {
    this.heightScale = scale;
  }

  setCorridor(corridor: RailCorridor | null): void {
    if (this.corridor === corridor) return;
    this.corridor = corridor;
    this.portalAnchorX = Number.NaN;
    this.portalAnchorZ = Number.NaN;
    this.clearCache();
  }

  /** Height used only by render meshes; heightAt remains the natural DEM API. */
  renderHeightAt(x: number, z: number): number {
    const natural = this.heightAt(x, z);
    return this.corridor?.modifiedHeightAt(x, z, natural) ?? natural;
  }

  private applyQuality(quality: Quality): void {
    this.quality = quality;
    const q = QUALITY_SETTINGS[quality];
    this.segments = q.segments;
    this.maxChunks = q.maxChunks;
    this.maxLevel = q.maxLevel;
    this.threshold = q.threshold;
    this.portalAnchorX = Number.NaN;
    this.portalAnchorZ = Number.NaN;
    this.clearCache();
  }

  heightAt(x: number, z: number): number {
    const tier = this.tierAt(x, z);
    if (!tier) return 200;
    const [x0, z0, x1, z1] = tier.bounds;
    const px = ((x - x0) / Math.max(1, x1 - x0)) * tier.meta.width - 0.5;
    const pz = ((z - z0) / Math.max(1, z1 - z0)) * tier.meta.height - 0.5;
    const h = sampleGrid(tier.data, tier.meta.width, tier.meta.height, px, pz) * 0.5;
    return Math.max(40, h);
  }

  private tierAt(x: number, z: number): TierRuntime | null {
    for (const tier of this.tiers) {
      const [x0, z0, x1, z1] = tier.bounds;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return tier;
    }
    return this.tiers[this.tiers.length - 1] || null;
  }

  private tierResolutionAt(x: number, z: number): number {
    return this.tierAt(x, z)?.resolution ?? 200;
  }

  update(camera: THREE.PerspectiveCamera, now: number): void {
    camera.updateMatrixWorld();
    this.updatePortalUniforms(camera);
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const leaves: Array<{ node: ChunkNode; distance: number }> = [];
    this.collect(camera, this.root, leaves);

    for (const entry of this.cache.values()) {
      if (entry.mesh) entry.mesh.visible = false;
    }

    leaves.sort((a, b) => a.distance - b.distance);
    const limit = Math.min(leaves.length, this.maxChunks);
    for (let i = 0; i < limit; i++) {
      const { node } = leaves[i];
      if (!node.mesh) node.mesh = this.buildChunk(node);
      node.mesh.visible = true;
      node.lastUsed = now;
    }
    this.visibleCount = limit;
    this.evict(now);
  }

  private updatePortalUniforms(camera: THREE.PerspectiveCamera): void {
    if (!this.corridor) {
      this.portalCountUniform.value = 0;
      return;
    }
    if (
      Number.isFinite(this.portalAnchorX)
      && Math.hypot(camera.position.x - this.portalAnchorX, camera.position.z - this.portalAnchorZ) < 48
    ) return;
    this.portalAnchorX = camera.position.x;
    this.portalAnchorZ = camera.position.z;
    const nearby = this.corridor.portalsNear(
      camera.position.x,
      camera.position.z,
      QUALITY_SETTINGS[this.quality].corridorDistance,
    ).slice(0, MAX_PORTAL_OPENINGS);
    for (let i = 0; i < nearby.length; i++) {
      const portal = nearby[i];
      this.portalUniforms.value[i].set(
        portal.x,
        portal.z,
        portal.tx * portal.inward,
        portal.tz * portal.inward,
      );
    }
    this.portalCountUniform.value = nearby.length;
  }

  private collect(
    camera: THREE.PerspectiveCamera,
    node: ChunkNode,
    out: Array<{ node: ChunkNode; distance: number }>,
  ): void {
    const cx = (node.x0 + node.x1) / 2;
    const cz = (node.z0 + node.z1) / 2;
    const size = node.x1 - node.x0;
    this.sphere.center.set(cx, this.heightAt(cx, cz) * this.heightScale + 120, cz);
    this.sphere.radius = size * 0.78 + 600;
    if (!this.frustum.intersectsSphere(this.sphere)) return;

    const dx = cx - camera.position.x;
    const dz = cz - camera.position.z;
    const distance = Math.max(1, Math.hypot(dx, dz));
    const pixels = (size * this.viewportHeight) / (2 * distance * this.fovTan);
    const resolution = this.tierResolutionAt(cx, cz);
    const cellSize = size / this.segments;

    const corridorSplit = !!this.corridor
      && distance < QUALITY_SETTINGS[this.quality].corridorDistance
      && node.level < this.maxLevel + 4
      && cellSize > QUALITY_SETTINGS[this.quality].corridorCell
      && pixels > 24
      && this.corridor.mayAffect(node.x0, node.z0, node.x1, node.z1);
    const canSplit = corridorSplit || (
      node.level < this.maxLevel &&
      cellSize > resolution * 1.05 &&
      pixels > this.threshold
    );
    if (!canSplit) {
      out.push({ node, distance });
      return;
    }

    if (!node.children) {
      const mx = (node.x0 + node.x1) / 2;
      const mz = (node.z0 + node.z1) / 2;
      const next = node.level + 1;
      node.children = [
        { key: `${next}:${node.x0}:${node.z0}`, level: next, x0: node.x0, z0: node.z0, x1: mx, z1: mz, children: null, mesh: null, lastUsed: 0 },
        { key: `${next}:${mx}:${node.z0}`, level: next, x0: mx, z0: node.z0, x1: node.x1, z1: mz, children: null, mesh: null, lastUsed: 0 },
        { key: `${next}:${node.x0}:${mz}`, level: next, x0: node.x0, z0: mz, x1: mx, z1: node.z1, children: null, mesh: null, lastUsed: 0 },
        { key: `${next}:${mx}:${mz}`, level: next, x0: mx, z0: mz, x1: node.x1, z1: node.z1, children: null, mesh: null, lastUsed: 0 },
      ];
    }
    for (const child of node.children) this.collect(camera, child, out);
  }

  private buildChunk(node: ChunkNode): THREE.Mesh {
    if (node.mesh) return node.mesh;
    const existing = this.cache.get(node.key);
    if (existing?.mesh) return existing.mesh;

    const seg = this.segments;
    const nx = node.x1 - node.x0;
    const nz = node.z1 - node.z0;
    const stepX = nx / seg;
    const stepZ = nz / seg;
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const corridor = this.corridor?.mayAffect(node.x0, node.z0, node.x1, node.z1)
      ? this.corridor
      : null;
    const surfaceAt = (x: number, z: number): number => {
      const natural = this.heightAt(x, z);
      return corridor?.modifiedHeightAt(x, z, natural) ?? natural;
    };

    for (let row = 0; row <= seg; row++) {
      const z = node.z0 + row * stepZ;
      for (let col = 0; col <= seg; col++) {
        const x = node.x0 + col * stepX;
        const natural = this.heightAt(x, z);
        const h = corridor?.modifiedHeightAt(x, z, natural) ?? natural;
        positions.push(x, h, z);

        const hx = surfaceAt(x + stepX * 0.5, z) - surfaceAt(x - stepX * 0.5, z);
        const hz = surfaceAt(x, z + stepZ * 0.5) - surfaceAt(x, z - stepZ * 0.5);
        const n = new THREE.Vector3(-hx, stepX, -hz).normalize();
        normals.push(n.x, n.y, n.z);

        const c = colorForHeight(h);
        const cutDepth = natural - h;
        if (cutDepth > 0.15) c.lerp(ROCK_COLOR, Math.min(0.72, 0.28 + cutDepth * 0.055));
        const steep = Math.max(0, 1 - n.y);
        if (steep > 0.12) c.lerp(ROCK_COLOR, Math.min(0.58, steep * 0.85));
        const noise = 0.93 + hash2(x, z) * 0.12;
        const shade = (0.72 + 0.28 * Math.max(0, n.y)) * noise;
        colors.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < seg; row++) {
      for (let col = 0; col < seg; col++) {
        const a = row * (seg + 1) + col;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Skirt: extend outer edges downward to hide LOD cracks.
    const vertexCount = (seg + 1) * (seg + 1);
    const skirt = Math.min(120, Math.max(18, nx * 0.05));
    const skirtStart = vertexCount;
    const edgePoints: Array<[number, number, number]> = [];
    for (let i = 0; i <= seg; i++) edgePoints.push([node.x0 + i * stepX, node.z0, 0]);
    for (let i = 1; i <= seg; i++) edgePoints.push([node.x1, node.z0 + i * stepZ, 1]);
    for (let i = 1; i <= seg; i++) edgePoints.push([node.x1 - i * stepX, node.z1, 2]);
    for (let i = 1; i < seg; i++) edgePoints.push([node.x0, node.z1 - i * stepZ, 3]);
    const edgeStart = skirtStart;
    for (const [x, z] of edgePoints) {
      const h = surfaceAt(x, z);
      positions.push(x, h, z);
      normals.push(0, 1, 0);
      colors.push(0.08, 0.12, 0.1);
    }
    for (const [x, z] of edgePoints) {
      const h = surfaceAt(x, z) - skirt;
      positions.push(x, h, z);
      normals.push(0, 1, 0);
      colors.push(0.05, 0.08, 0.07);
    }
    const count = edgePoints.length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      indices.push(edgeStart + i, edgeStart + count + i, edgeStart + j);
      indices.push(edgeStart + j, edgeStart + count + i, edgeStart + count + j);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    node.mesh = mesh;
    this.cache.set(node.key, node);
    return mesh;
  }

  private evict(now: number): void {
    if (this.cache.size <= 520) return;
    const entries = [...this.cache.values()]
      .filter((n) => !n.mesh?.visible && n.lastUsed < now - 2)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const remove = this.cache.size - 480;
    for (let i = 0; i < remove && i < entries.length; i++) {
      const node = entries[i];
      if (node.mesh) {
        this.group.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.mesh = null;
      }
      this.cache.delete(node.key);
    }
  }

  private clearCache(): void {
    for (const node of this.cache.values()) {
      if (node.mesh) {
        this.group.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.mesh = null;
      }
    }
    this.cache.clear();
    this.root.children = null;
    this.root.mesh = null;
  }

  dispose(): void {
    this.clearCache();
    this.material.dispose();
  }
}

function hash2(x: number, z: number): number {
  const v = Math.sin(x * 0.731 + z * 1.137) * 43758.5453;
  return v - Math.floor(v);
}

function sampleGrid(arr: Int16Array, w: number, h: number, px: number, py: number): number {
  const x = Math.max(0, Math.min(w - 1, px));
  const y = Math.max(0, Math.min(h - 1, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = arr[y0 * w + x0];
  const b = arr[y0 * w + x1];
  const c = arr[y1 * w + x0];
  const d = arr[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
