import type { CityManifest } from '@/data/types';

export class Projection {
  readonly lon0: number;
  readonly lat0: number;
  readonly mPerDegLon: number;
  readonly mPerDegLat: number;

  constructor(manifest: CityManifest) {
    this.lon0 = manifest.projection.lon0;
    this.lat0 = manifest.projection.lat0;
    this.mPerDegLon = manifest.projection.mPerDegLon;
    this.mPerDegLat = manifest.projection.mPerDegLat;
  }

  toLocal(lon: number, lat: number): [number, number] {
    return [(lon - this.lon0) * this.mPerDegLon, (this.lat0 - lat) * this.mPerDegLat];
  }

  toLonLat(x: number, z: number): [number, number] {
    return [this.lon0 + x / this.mPerDegLon, this.lat0 - z / this.mPerDegLat];
  }
}
