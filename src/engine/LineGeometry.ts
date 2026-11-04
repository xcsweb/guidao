import * as THREE from 'three';
import type { LineData } from '@/data/types';
import { TerrainSystem } from './Terrain';

export interface StationPoint {
  id: string;
  name: string;
  s: number;
  x: number;
  z: number;
  y: number;
}

export interface PathSample {
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
}

export class LineGeometry {
  readonly line: LineData;
  readonly length: number;
  readonly stations: StationPoint[];
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly ys: Float32Array;
  readonly cum: Float32Array;
  readonly bridges: Array<[number, number]>;
  readonly tunnels: Array<[number, number]>;
  readonly closedLoop: boolean;

  constructor(line: LineData, terrain: TerrainSystem) {
    this.line = line;
    this.closedLoop = line.closedLoop;

    const control: THREE.Vector3[] = [];
    for (let i = 0; i < line.path.length; i += 2) {
      control.push(new THREE.Vector3(line.path[i], 0, line.path[i + 1]));
    }
    if (this.closedLoop && control.length > 2) {
      const first = control[0];
      const last = control[control.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 120) control.pop();
    }

    const curve = new THREE.CatmullRomCurve3(control, this.closedLoop, 'centripetal', 0.5);
    const approxLength = Math.max(line.length, 1000);
    const count = Math.max(200, Math.min(5200, Math.round(approxLength / 20)));
    const pts = curve.getPoints(count - 1);
    if (this.closedLoop && pts.length > 2) pts.push(pts[0].clone());

    const n = pts.length;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.zs[i] = pts[i].z;
      this.cum[i] = i === 0 ? 0 : this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    this.length = this.cum[n - 1] || 1;
    const scale = this.length / (line.length || this.length);

    const baseY = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.xs[i];
      const z = this.zs[i];
      const localMax = Math.max(
        terrain.heightAt(x, z),
        terrain.heightAt(x + 25, z),
        terrain.heightAt(x - 25, z),
        terrain.heightAt(x, z + 25),
        terrain.heightAt(x, z - 25),
      );
      baseY[i] = localMax + 2.5;
    }

    this.bridges = line.surface.bridge.map(([a, b]) => [a * scale, b * scale] as [number, number]);
    this.tunnels = line.surface.tunnel.map(([a, b]) => [a * scale, b * scale] as [number, number]);

    for (const [a, b] of this.bridges) {
      const startIdx = this.indexAt(a);
      const endIdx = this.indexAt(b);
      const deck = Math.max(baseY[startIdx], baseY[endIdx]) + 7;
      const ramp = 40;
      for (let i = startIdx; i <= endIdx; i++) {
        const s = this.cum[i];
        const edge = Math.min(s - a, b - s);
        const t = Math.max(0, Math.min(1, edge / ramp));
        baseY[i] = deck * t + baseY[i] * (1 - t) * 0.35 + baseY[i] * 0.65 * (1 - t);
      }
    }

    // gentle smoothing to avoid stair-step elevations
    const smoothed = new Float32Array(n);
    const win = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -win; k <= win; k++) {
        let j = i + k;
        if (this.closedLoop) j = ((j % n) + n) % n;
        else j = Math.max(0, Math.min(n - 1, j));
        sum += baseY[j];
        cnt++;
      }
      smoothed[i] = sum / cnt;
    }
    this.ys.set(smoothed);

    this.stations = line.stations
      .map((st) => {
        const s = Math.max(0, Math.min(this.length, (st.dist / (line.length || 1)) * this.length));
        const idx = this.indexAt(s);
        return {
          id: st.id,
          name: st.name,
          s,
          x: this.xs[idx],
          z: this.zs[idx],
          y: this.ys[idx],
        };
      })
      .sort((a, b) => a.s - b.s);
  }

  sampleAt(sRaw: number, out: PathSample): boolean {
    let s = sRaw;
    if (this.closedLoop) s = ((s % this.length) + this.length) % this.length;
    else s = Math.max(0, Math.min(this.length, s));
    const n = this.xs.length;
    const idx = Math.min(n - 2, this.indexAt(s));
    const segLen = this.cum[idx + 1] - this.cum[idx] || 1;
    const t = Math.max(0, Math.min(1, (s - this.cum[idx]) / segLen));
    out.x = this.xs[idx] * (1 - t) + this.xs[idx + 1] * t;
    out.z = this.zs[idx] * (1 - t) + this.zs[idx + 1] * t;
    out.y = this.ys[idx] * (1 - t) + this.ys[idx + 1] * t;
    const a = Math.max(0, idx - 2);
    const b = Math.min(n - 1, idx + 3);
    const dx = this.xs[b] - this.xs[a];
    const dz = this.zs[b] - this.zs[a];
    const len = Math.hypot(dx, dz) || 1;
    out.tx = dx / len;
    out.tz = dz / len;
    return true;
  }

  pointAt(s: number): { x: number; y: number; z: number } {
    const i = this.indexAt(s);
    return { x: this.xs[i], y: this.ys[i], z: this.zs[i] };
  }

  isInsideTunnel(s: number): boolean {
    return this.tunnels.some(([a, b]) => s >= a && s <= b);
  }

  private indexAt(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  buildBridgeDecks(width = 9): THREE.BufferGeometry | null {
    if (!this.bridges.length) return null;
    const positions: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (const [a, b] of this.bridges) {
      const i0 = this.indexAt(a);
      const i1 = this.indexAt(b);
      if (i1 - i0 < 2) continue;
      for (let i = i0; i <= i1; i++) {
        const x = this.xs[i];
        const z = this.zs[i];
        const y = this.ys[i] - 1.6;
        const prev = Math.max(i0, i - 1);
        const next = Math.min(i1, i + 1);
        let dx = this.xs[next] - this.xs[prev];
        let dz = this.zs[next] - this.zs[prev];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const px = (-dz * width) / 2;
        const pz = (dx * width) / 2;
        positions.push(x + px, y, z + pz, x - px, y, z - pz);
      }
      const count = i1 - i0 + 1;
      for (let i = 0; i < count - 1; i++) {
        const v = base + i * 2;
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
      base += count * 2;
    }
    if (!indices.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  buildRibbon(width: number, yOffset: number, closed: boolean): THREE.BufferGeometry {
    const n = this.xs.length;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const half = width / 2;
    for (let i = 0; i < n; i++) {
      const prev = Math.max(0, i - 1);
      const next = Math.min(n - 1, i + 1);
      let dx = this.xs[next] - this.xs[prev];
      let dz = this.zs[next] - this.zs[prev];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const px = -dz * half;
      const pz = dx * half;
      const x = this.xs[i];
      const y = this.ys[i] + yOffset;
      const z = this.zs[i];
      positions[i * 6] = x + px;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z + pz;
      positions[i * 6 + 3] = x - px;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z - pz;
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = this.cum[i] / 20;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = this.cum[i] / 20;
    }
    const indices: number[] = [];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const a = i * 2;
      const b = i * 2 + 1;
      const c = j * 2;
      const d = j * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }
}
