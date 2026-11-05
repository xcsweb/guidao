import type { LineGeometry, PathSample } from './LineGeometry';

export const TRACK_SLOT_OFFSET = 0.78;
export const PORTAL_HOLE_HALF_WIDTH = 5.25;
export const PORTAL_HOLE_BACK = 9;
export const PORTAL_HOLE_AHEAD = 22;

const CELL_SIZE = 96;
const SLOT_HALF_WIDTH = 5.4;
const SLOPE_START = 19;
const OUTER_WIDTH = 34;
const SIDE_SLOPE = 0.88;
const PORTAL_COVER_DEPTH = 6.8;

interface CorridorSegment {
  ax: number;
  az: number;
  ay: number;
  dx: number;
  dz: number;
  dy: number;
  length2: number;
}

export interface TunnelPortal {
  id: string;
  lineId: string;
  range: [number, number];
  s: number;
  inward: 1 | -1;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  groundY: number;
  burial: number;
  interiorDepth: number;
}

/**
 * Spatial hash of only the track that can affect the visible terrain. Bored
 * tunnel middles and bridges are deliberately absent from the cut index.
 */
export class RailCorridor {
  readonly portals: TunnelPortal[] = [];

  private cells = new Map<string, CorridorSegment[]>();
  private portalCells = new Map<string, TunnelPortal[]>();
  private influencedCells = new Set<string>();
  private minX = Infinity;
  private minZ = Infinity;
  private maxX = -Infinity;
  private maxZ = -Infinity;
  private sample: PathSample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

  constructor(geometries: Map<string, LineGeometry>) {
    for (const geo of geometries.values()) {
      const linePortals = this.buildPortals(geo);
      this.portals.push(...linePortals);
      this.indexCutSegments(geo, linePortals);
    }
    for (const portal of this.portals) this.indexPortal(portal);
  }

  /** Modified render elevation; TerrainSystem.heightAt remains the natural DEM. */
  modifiedHeightAt(x: number, z: number, naturalY: number): number {
    const candidates = this.cells.get(cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)));
    if (!candidates) return naturalY;
    let result = naturalY;
    for (const segment of candidates) {
      const t = segment.length2 > 0
        ? Math.max(0, Math.min(1, ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / segment.length2))
        : 0;
      const px = segment.ax + segment.dx * t;
      const pz = segment.az + segment.dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance >= OUTER_WIDTH) continue;
      const trackY = segment.ay + segment.dy * t;
      let target = trackY - TRACK_SLOT_OFFSET
        + Math.max(0, distance - SLOT_HALF_WIDTH) * SIDE_SLOPE;
      if (distance > SLOPE_START) {
        const tEdge = smoothstep01((distance - SLOPE_START) / (OUTER_WIDTH - SLOPE_START));
        target += (Math.max(naturalY, target) - target) * tEdge;
      }
      result = Math.min(result, target);
    }
    return result;
  }

  /** Conservative, cell-based broad phase used by the terrain quadtree. */
  mayAffect(x0: number, z0: number, x1: number, z1: number): boolean {
    if (x1 < this.minX || x0 > this.maxX || z1 < this.minZ || z0 > this.maxZ) return false;
    const cx0 = Math.floor(x0 / CELL_SIZE);
    const cz0 = Math.floor(z0 / CELL_SIZE);
    const cx1 = Math.floor(x1 / CELL_SIZE);
    const cz1 = Math.floor(z1 / CELL_SIZE);
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 256) return true;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.influencedCells.has(cellKey(cx, cz))) return true;
      }
    }
    return false;
  }

  /** Local rectangular opening at a portal, never along the bored tunnel. */
  isPortalOpening(x: number, z: number): boolean {
    const candidates = this.portalCells.get(cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)));
    if (!candidates) return false;
    for (const portal of candidates) {
      const fx = portal.tx * portal.inward;
      const fz = portal.tz * portal.inward;
      const dx = x - portal.x;
      const dz = z - portal.z;
      const along = dx * fx + dz * fz;
      if (along < -PORTAL_HOLE_BACK || along > PORTAL_HOLE_AHEAD) continue;
      const lateral = dx * -fz + dz * fx;
      if (Math.abs(lateral) <= PORTAL_HOLE_HALF_WIDTH) return true;
    }
    return false;
  }

  portalsNear(x: number, z: number, radius: number): TunnelPortal[] {
    const found = new Map<string, { portal: TunnelPortal; distance2: number }>();
    const cx0 = Math.floor((x - radius) / CELL_SIZE);
    const cz0 = Math.floor((z - radius) / CELL_SIZE);
    const cx1 = Math.floor((x + radius) / CELL_SIZE);
    const cz1 = Math.floor((z + radius) / CELL_SIZE);
    const radius2 = radius * radius;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const candidates = this.portalCells.get(cellKey(cx, cz));
        if (!candidates) continue;
        for (const portal of candidates) {
          const distance2 = (portal.x - x) ** 2 + (portal.z - z) ** 2;
          if (distance2 > radius2) continue;
          const previous = found.get(portal.id);
          if (!previous || distance2 < previous.distance2) found.set(portal.id, { portal, distance2 });
        }
      }
    }
    return [...found.values()]
      .sort((a, b) => a.distance2 - b.distance2)
      .map((entry) => entry.portal);
  }

  private buildPortals(geo: LineGeometry): TunnelPortal[] {
    const result: TunnelPortal[] = [];
    for (const range of geo.tunnels) {
      const [a, b] = range;
      if (!(b > a)) continue;
      const i0 = indexAt(geo.cum, a);
      const i1 = Math.min(geo.cum.length - 1, indexAt(geo.cum, b) + 1);
      const mid = (a + b) * 0.5;
      const im = indexAt(geo.cum, mid);
      let maxDepth = 0;
      for (let i = i0; i <= i1; i++) maxDepth = Math.max(maxDepth, geo.groundYs[i] - geo.ys[i]);
      const cover = Math.min(PORTAL_COVER_DEPTH, maxDepth * 0.8);
      let startS = findDepthCrossing(geo, i0, im, 1, cover) ?? mid;
      let endS = findDepthCrossing(geo, i1, im, -1, cover) ?? mid;
      startS = Math.max(a, Math.min(mid, startS));
      endS = Math.min(b, Math.max(mid, endS));
      if (endS - startS < 4) {
        startS = Math.max(a, mid - Math.min(2, (b - a) * 0.1));
        endS = Math.min(b, mid + Math.min(2, (b - a) * 0.1));
      }
      result.push(this.makePortal(geo, range, startS, 1, Math.max(2, endS - startS - 0.5)));
      result.push(this.makePortal(geo, range, endS, -1, Math.max(2, endS - startS - 0.5)));
    }
    return result;
  }

  private makePortal(
    geo: LineGeometry,
    range: [number, number],
    s: number,
    inward: 1 | -1,
    availableDepth: number,
  ): TunnelPortal {
    geo.sampleAt(s, this.sample);
    const groundY = valueAt(geo.groundYs, geo.cum, s);
    return {
      id: `${geo.line.id}:${range[0].toFixed(2)}:${inward === 1 ? 'in' : 'out'}`,
      lineId: geo.line.id,
      range: [...range],
      s,
      inward,
      x: this.sample.x,
      y: this.sample.y,
      z: this.sample.z,
      tx: this.sample.tx,
      tz: this.sample.tz,
      groundY,
      burial: groundY - this.sample.y,
      interiorDepth: Math.min(30, availableDepth),
    };
  }

  private indexCutSegments(geo: LineGeometry, portals: TunnelPortal[]): void {
    const specialBounds: number[] = [];
    for (const ranges of [geo.bridges, geo.tunnels]) {
      for (const [a, b] of ranges) specialBounds.push(a, b);
    }
    for (const portal of portals) specialBounds.push(portal.s);
    specialBounds.sort((a, b) => a - b);

    for (let i = 0; i < geo.xs.length - 1; i++) {
      const s0 = geo.cum[i];
      const s1 = geo.cum[i + 1];
      if (!(s1 > s0)) continue;
      const splits = [s0];
      for (const bound of specialBounds) {
        if (bound > s0 && bound < s1) splits.push(bound);
      }
      splits.push(s1);
      for (let k = 0; k < splits.length - 1; k++) {
        const a = splits[k];
        const b = splits[k + 1];
        const mid = (a + b) * 0.5;
        if (insideAny(mid, geo.bridges)) continue;
        const tunnel = geo.tunnels.find(([ta, tb]) => mid >= ta && mid <= tb);
        if (tunnel) {
          const startS = portals.find((portal) => portal.inward === 1 && sameRange(portal.range, tunnel))?.s;
          const endS = portals.find((portal) => portal.inward === -1 && sameRange(portal.range, tunnel))?.s;
          const inApproach = (startS !== undefined && mid <= startS)
            || (endS !== undefined && mid >= endS);
          if (!inApproach) continue;
        }
        geo.sampleAt(a, this.sample);
        const ax = this.sample.x;
        const az = this.sample.z;
        const ay = this.sample.y;
        geo.sampleAt(b, this.sample);
        this.addSegment({
          ax,
          az,
          ay,
          dx: this.sample.x - ax,
          dz: this.sample.z - az,
          dy: this.sample.y - ay,
          length2: (this.sample.x - ax) ** 2 + (this.sample.z - az) ** 2,
        });
      }
    }
  }

  private addSegment(segment: CorridorSegment): void {
    const bx = segment.ax + segment.dx;
    const bz = segment.az + segment.dz;
    const minX = Math.min(segment.ax, bx) - OUTER_WIDTH;
    const minZ = Math.min(segment.az, bz) - OUTER_WIDTH;
    const maxX = Math.max(segment.ax, bx) + OUTER_WIDTH;
    const maxZ = Math.max(segment.az, bz) + OUTER_WIDTH;
    this.expandBounds(minX, minZ, maxX, maxZ);
    const cx0 = Math.floor(minX / CELL_SIZE);
    const cz0 = Math.floor(minZ / CELL_SIZE);
    const cx1 = Math.floor(maxX / CELL_SIZE);
    const cz1 = Math.floor(maxZ / CELL_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cellKey(cx, cz);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(segment);
        this.influencedCells.add(key);
      }
    }
  }

  private indexPortal(portal: TunnelPortal): void {
    const radius = PORTAL_HOLE_AHEAD + PORTAL_HOLE_HALF_WIDTH;
    this.expandBounds(portal.x - radius, portal.z - radius, portal.x + radius, portal.z + radius);
    const cx0 = Math.floor((portal.x - radius) / CELL_SIZE);
    const cz0 = Math.floor((portal.z - radius) / CELL_SIZE);
    const cx1 = Math.floor((portal.x + radius) / CELL_SIZE);
    const cz1 = Math.floor((portal.z + radius) / CELL_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cellKey(cx, cz);
        let list = this.portalCells.get(key);
        if (!list) {
          list = [];
          this.portalCells.set(key, list);
        }
        list.push(portal);
        this.influencedCells.add(key);
      }
    }
  }

  private expandBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.minX = Math.min(this.minX, minX);
    this.minZ = Math.min(this.minZ, minZ);
    this.maxX = Math.max(this.maxX, maxX);
    this.maxZ = Math.max(this.maxZ, maxZ);
  }
}

function cellKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function insideAny(s: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => s >= a && s <= b);
}

function sameRange(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function indexAt(cum: Float32Array, s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

function valueAt(values: Float32Array, cum: Float32Array, s: number): number {
  const index = Math.min(cum.length - 2, indexAt(cum, s));
  const span = cum[index + 1] - cum[index] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[index]) / span));
  return values[index] * (1 - t) + values[index + 1] * t;
}

function findDepthCrossing(
  geo: LineGeometry,
  from: number,
  to: number,
  step: 1 | -1,
  target: number,
): number | null {
  let previous = from;
  let previousDepth = geo.groundYs[previous] - geo.ys[previous];
  for (let i = from + step; step > 0 ? i <= to : i >= to; i += step) {
    const depth = geo.groundYs[i] - geo.ys[i];
    if (depth >= target && previousDepth < target) {
      const t = (target - previousDepth) / Math.max(1e-6, depth - previousDepth);
      return geo.cum[previous] + (geo.cum[i] - geo.cum[previous]) * t;
    }
    previous = i;
    previousDepth = depth;
  }
  return null;
}
