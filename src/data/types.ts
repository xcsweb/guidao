export type Vec2 = [number, number];
export type Bbox = [number, number, number, number];

export interface CityManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  subtitle: string;
  bbox: Bbox;
  center: Vec2;
  projection: {
    lon0: number;
    lat0: number;
    mPerDegLon: number;
    mPerDegLat: number;
  };
  elevation: {
    min: number;
    max: number;
    defaultExaggeration: number;
    exaggerationRange: [number, number];
  };
  boundsLocal: Bbox;
  assets: {
    network: string;
    terrain: string;
    features: string;
    buildings: string;
  };
  counts: {
    lines: number;
    stations: number;
    buildings: number;
    rivers: number;
    trackPoints: number;
  };
  attribution: {
    osm: string;
    osmUrl: string;
    terrain: string;
    terrainUrl: string;
    realtime: string;
  };
  generatedAt: string;
}

export interface LineStationRef {
  id: string;
  name: string;
  dist: number;
}

export interface LineData {
  id: string;
  ref: string;
  name: string;
  color: string;
  /** flat local-meter coordinates: [x0,z0,x1,z1,...] */
  path: number[];
  length: number;
  closedLoop: boolean;
  bounds: Bbox;
  stations: LineStationRef[];
  surface: {
    bridge: Array<[number, number]>;
    tunnel: Array<[number, number]>;
  };
  termini: [string, string];
  speedKph: number;
}

export interface StationData {
  id: string;
  name: string;
  lon: number;
  lat: number;
  x: number;
  z: number;
  lines: string[];
  elevation?: number;
  /** Derived from the line's surface/tunnel ranges at this station. */
  stationType?: 'underground' | 'surface' | 'mixed';
}

export interface ServiceConfig {
  startSec: number;
  endSec: number;
  peakRanges: Array<[number, number]>;
  headwayPeakSec: number;
  headwayOffSec: number;
  dwellSec: number;
}

export interface NetworkFile {
  lines: LineData[];
  stations: StationData[];
  service: ServiceConfig;
}

export interface TerrainTier {
  id: string;
  file: string;
  bbox: Bbox;
  width: number;
  height: number;
  minH: number;
  maxH: number;
  /** meters covered by one pixel horizontally / vertically */
  resolutionX: number;
  resolutionZ: number;
}

export interface TerrainMeta {
  quantization: number;
  tiers: TerrainTier[];
}

export interface RiverData {
  name: string;
  width: number;
  /** flat local-meter coordinates */
  path: number[];
}

export interface FeaturesFile {
  rivers: RiverData[];
  buildings: {
    file: string;
    count: number;
    /** floats per building: x, z, halfWidth, halfDepth, height, rotation */
    stride: number;
  };
}

export interface CityRegistryEntry {
  id: string;
  name: string;
  subtitle: string;
  manifest: string;
}

export interface CityRegistry {
  defaultCity: string;
  cities: CityRegistryEntry[];
}

export function linePathPoints(line: LineData): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < line.path.length; i += 2) pts.push([line.path[i], line.path[i + 1]]);
  return pts;
}
