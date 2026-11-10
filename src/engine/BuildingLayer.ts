import * as THREE from 'three';
import type { Quality } from '@/state/store';
import { TerrainSystem } from './Terrain';

const CELL = 50000;

interface Cell {
  mesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  radius: number;
}

export class BuildingLayer {
  readonly group = new THREE.Group();
  private cells: Cell[] = [];
  private material: THREE.MeshLambertMaterial;
  private maxDistance = 22000;
  private enabled = true;
  private geometry: THREE.BoxGeometry;
  private texture: THREE.CanvasTexture;

  constructor(
    data: Float32Array,
    stride: number,
    terrain: TerrainSystem,
    skipNear?: (x: number, z: number) => boolean,
  ) {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.translate(0, 0.5, 0);
    const uv = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    // Top faces (vertices 8-15) sample a dedicated concrete roof patch.
    const roofUv: Array<[number, number]> = [
      [0.78, 0.82],
      [0.93, 0.82],
      [0.93, 0.97],
      [0.78, 0.97],
    ];
    for (let i = 8; i < 16; i++) {
      const [u, v] = roofUv[(i - 8) % 4];
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    this.texture = createFacadeTexture();
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.texture });

    const buckets = new Map<string, number[]>();
    for (let i = 0; i < data.length; i += stride) {
      const x = data[i];
      const z = data[i + 1];
      if (skipNear && skipNear(x, z)) continue;
      const key = `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(i);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    for (const indices of buckets.values()) {
      if (indices.length === 0) continue;
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, indices.length);
      let cx = 0;
      let cz = 0;
      indices.forEach((idx, i) => {
        const x = data[idx];
        const z = data[idx + 1];
        const halfW = Math.min(90, Math.max(1.5, data[idx + 2])) * 2;
        const halfD = Math.min(90, Math.max(1.5, data[idx + 3])) * 2;
        const height = Math.max(4, data[idx + 4]);
        const angle = data[idx + 5];
        pos.set(x, terrain.heightAt(x, z) - 6, z);
        q.setFromAxisAngle(up, -angle);
        scale.set(halfW, height, halfD);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(i, m);
        cx += x;
        cz += z;
        const seed = ((idx / stride) * 0.618) % 1;
        const tone = 0.58 + seed * 0.26;
        color.setRGB(tone * 1.02, tone, tone * 0.95);
        if (height > 90) color.setRGB(tone * 1.08, tone * 1.02, tone * 0.92);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.cells.push({
        mesh,
        center: new THREE.Vector3(cx / indices.length, 0, cz / indices.length),
        radius: CELL * 0.85,
      });
    }
  }

  setQuality(quality: Quality): void {
    this.maxDistance = quality === 'low' ? 0 : quality === 'medium' ? 40000 : 65000;
    this.enabled = quality !== 'low';
    this.group.visible = this.enabled;
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.group.visible = visible;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    const limit = this.maxDistance * this.maxDistance;
    for (const cell of this.cells) {
      const dx = cell.center.x - camera.position.x;
      const dz = cell.center.z - camera.position.z;
      cell.mesh.visible = dx * dx + dz * dz < limit;
    }
  }

  dispose(): void {
    for (const cell of this.cells) cell.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function createFacadeTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3f474e';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 12;
  const w = size / cols;
  const h = size / rows;
  const pad = 3;
  for (let row = 0; row < rows; row++) {
    // Spandrel band under each floor line gives the facade a horizontal rhythm.
    ctx.fillStyle = 'rgba(20, 25, 30, 0.5)';
    ctx.fillRect(0, row * h + h - 2, size, 2);
    ctx.fillStyle = 'rgba(150, 158, 164, 0.12)';
    ctx.fillRect(0, row * h, size, 1);
    for (let col = 0; col < cols; col++) {
      const r = Math.random();
      const lit = r > 0.66;
      ctx.fillStyle = lit
        ? r > 0.94
          ? 'rgba(255, 216, 158, 0.92)'
          : 'rgba(222, 186, 132, 0.6)'
        : 'rgba(22, 28, 34, 0.85)';
      ctx.fillRect(col * w + pad, row * h + pad, w - pad * 2, h - pad * 2.4);
      // Window head highlight and sill shadow.
      ctx.fillStyle = lit ? 'rgba(255, 255, 255, 0.1)' : 'rgba(120, 138, 150, 0.18)';
      ctx.fillRect(col * w + pad, row * h + pad, w - pad * 2, 1);
      ctx.fillStyle = 'rgba(8, 12, 15, 0.55)';
      ctx.fillRect(col * w + pad, row * h + h - pad * 2.4, w - pad * 2, 1);
    }
  }

  // Concrete roof patch, sampled by the top faces of every building box.
  const rx = Math.round(0.78 * size);
  const ry = Math.round(0.03 * size);
  const rw = Math.round((0.93 - 0.78) * size);
  const rh = Math.round((0.97 - 0.82) * size);
  ctx.fillStyle = '#8d9499';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = 'rgba(58, 66, 71, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(rx, ry + (rh * i) / 4);
    ctx.lineTo(rx + rw, ry + (rh * i) / 4);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(104, 112, 117, 0.9)';
  ctx.fillRect(rx + rw * 0.12, ry + rh * 0.18, rw * 0.22, rh * 0.2);
  ctx.fillRect(rx + rw * 0.58, ry + rh * 0.55, rw * 0.26, rh * 0.24);
  ctx.fillStyle = 'rgba(226, 231, 233, 0.35)';
  ctx.fillRect(rx, ry, rw, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
