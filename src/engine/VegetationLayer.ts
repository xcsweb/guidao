import * as THREE from 'three';
import type { Quality } from '@/state/store';
import { LineGeometry } from './LineGeometry';
import { TerrainSystem } from './Terrain';

interface LineForest {
  mesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  radius: number;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VegetationLayer {
  readonly group = new THREE.Group();
  private forests: LineForest[] = [];
  private material: THREE.MeshLambertMaterial;
  private geometry: THREE.ConeGeometry;
  private enabled = true;

  constructor(geometries: Map<string, LineGeometry>, terrain: TerrainSystem) {
    this.geometry = new THREE.ConeGeometry(4.2, 13, 6);
    this.geometry.translate(0, 6.5, 0);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const rand = mulberry32(20261104);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    for (const geo of geometries.values()) {
      const count = Math.max(180, Math.min(4400, Math.round(geo.length / 22)));
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
      let placed = 0;
      let attempts = 0;
      while (placed < count && attempts < count * 8) {
        attempts++;
        const idx = Math.floor(rand() * geo.xs.length);
        const x0 = geo.xs[idx];
        const z0 = geo.zs[idx];
        const angle = rand() * Math.PI * 2;
        const dist = 45 + rand() * 230;
        const x = x0 + Math.cos(angle) * dist;
        const z = z0 + Math.sin(angle) * dist;
        const h = terrain.heightAt(x, z);
        if (h < 60) continue;
        pos.set(x, h - 3, z);
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        const s = 0.6 + rand() * 0.5;
        scale.set(s, 0.65 + rand() * 0.55, s);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(placed, m);
        const tone = 0.5 + rand() * 0.45;
        color.setRGB(0.07 * tone, 0.15 * tone, 0.09 * tone);
        mesh.setColorAt(placed, color);
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      const b = geo.line.bounds;
      this.forests.push({
        mesh,
        center: new THREE.Vector3((b[0] + b[2]) / 2, 0, (b[1] + b[3]) / 2),
        radius: Math.max(b[2] - b[0], b[3] - b[1]) * 0.5 + 500,
      });
    }
  }

  setQuality(quality: Quality): void {
    this.enabled = quality !== 'low';
    this.group.visible = this.enabled;
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.group.visible = visible;
  }

  dispose(): void {
    for (const forest of this.forests) forest.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
