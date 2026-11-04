import * as THREE from 'three';
import type { RiverData } from '@/data/types';
import { TerrainSystem } from './Terrain';

const CELL = 4000;

interface CellBuild {
  positions: number[];
  uvs: number[];
  indices: number[];
  baseIndex: number;
}

export class WaterLayer {
  readonly group = new THREE.Group();
  private cells: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private visibleEnabled = true;

  constructor(rivers: RiverData[], terrain: TerrainSystem) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0x16394a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const buckets = new Map<string, CellBuild>();
    for (const river of rivers) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < river.path.length; i += 2) pts.push([river.path[i], river.path[i + 1]]);
      if (pts.length < 2) continue;

      const waterY: number[] = pts.map(([x, z]) => terrain.heightAt(x, z) + 1.2);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < waterY.length - 1; i++) {
          waterY[i] = (waterY[i - 1] + waterY[i] * 2 + waterY[i + 1]) / 4;
        }
      }

      const half = river.width / 2;
      const positions: number[] = [];
      const uvs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        let dx = next[0] - prev[0];
        let dz = next[1] - prev[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const px = -dz * half;
        const pz = dx * half;
        const x = pts[i][0];
        const z = pts[i][1];
        const y = waterY[i];
        positions.push(x + px, y, z + pz, x - px, y, z - pz);
        uvs.push(0, i / 20, 1, i / 20);
      }
      const indices: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = a + 2;
        const d = b + 2;
        indices.push(a, c, b, b, c, d);
      }

      let cx = 0;
      let cz = 0;
      for (const p of pts) {
        cx += p[0];
        cz += p[1];
      }
      cx /= pts.length;
      cz /= pts.length;
      const key = `${Math.floor(cx / CELL)}:${Math.floor(cz / CELL)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { positions: [], uvs: [], indices: [], baseIndex: 0 };
        buckets.set(key, bucket);
      }
      bucket.baseIndex = bucket.positions.length / 3;
      bucket.positions.push(...positions);
      bucket.uvs.push(...uvs);
      for (const idx of indices) bucket.indices.push(idx + bucket.baseIndex);
    }

    for (const bucket of buckets.values()) {
      if (bucket.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bucket.positions), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bucket.uvs), 2));
      geo.setIndex(bucket.indices);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.cells.push(mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.visibleEnabled = visible;
    this.group.visible = visible;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.visibleEnabled) return;
    const maxDist = 60000;
    const maxDist2 = maxDist * maxDist;
    for (const cell of this.cells) {
      const sphere = cell.geometry.boundingSphere;
      if (!sphere) continue;
      const dx = sphere.center.x - camera.position.x;
      const dz = sphere.center.z - camera.position.z;
      cell.visible = dx * dx + dz * dz < maxDist2;
    }
  }

  dispose(): void {
    for (const cell of this.cells) cell.geometry.dispose();
    this.material.dispose();
  }
}
