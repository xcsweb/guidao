import type { NetworkFile } from '@/data/types';
import { LineGeometry } from '@/engine/LineGeometry';
import type { SimTrain } from './Timetable';

interface ExternalTrain {
  id?: string;
  lineId: string;
  direction?: number;
  distanceAlong?: number;
  distance?: number;
  speedKph?: number;
  nextStationId?: string;
  etaSec?: number;
}

interface ExternalSnapshot {
  asOf?: number;
  source?: string;
  trains: ExternalTrain[];
}

export interface ResolvedTrains {
  trains: SimTrain[];
  kind: 'simulated' | 'http';
  label: string;
  asOf: number;
  error: string | null;
}

export class HttpRealtimeProvider {
  private url: string;
  private snapshot: ExternalSnapshot | null = null;
  private snapshotAt = 0;
  private error: string | null = null;
  private timer: number | null = null;
  private abort: AbortController | null = null;

  constructor(url: string) {
    this.url = url;
  }

  start(): void {
    if (this.timer !== null) return;
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), 5000);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.abort?.abort();
  }

  private async poll(): Promise<void> {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(this.url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ExternalSnapshot;
      if (!data || !Array.isArray(data.trains)) throw new Error('数据格式无效');
      this.snapshot = data;
      this.snapshotAt = Date.now();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  resolve(
    network: NetworkFile,
    geometries: Map<string, LineGeometry>,
    simulated: SimTrain[],
    simulatedAsOf: number,
  ): ResolvedTrains {
    const fresh = this.snapshot && Date.now() - this.snapshotAt < 20000;
    if (!fresh) {
      return {
        trains: simulated,
        kind: 'simulated',
        label: this.error ? '模拟班次（实时源不可用）' : '模拟班次',
        asOf: simulatedAsOf,
        error: this.error,
      };
    }
    const lineMap = new Map(network.lines.map((l) => [l.id, l]));
    const trains: SimTrain[] = [];
    for (const raw of this.snapshot!.trains) {
      const line = lineMap.get(raw.lineId);
      const geo = geometries.get(raw.lineId);
      if (!line || !geo) continue;
      const direction = raw.direction === 1 ? 1 : 0;
      const distance = Number(raw.distanceAlong ?? raw.distance ?? 0);
      const s = direction === 0 ? distance : geo.length - distance;
      let next = geo.stations[geo.stations.length - 1];
      for (const st of geo.stations) {
        if (st.s > s + 5) {
          next = st;
          break;
        }
      }
      const speedKph = Number.isFinite(raw.speedKph) ? Number(raw.speedKph) : 0;
      const etaSec =
        raw.etaSec != null && Number.isFinite(raw.etaSec)
          ? Number(raw.etaSec)
          : speedKph > 1
            ? ((next.s - s) / (speedKph * 1000 / 3600)) * 0.9
            : 0;
      trains.push({
        id: raw.id || `${line.id}-${direction}-ext-${trains.length}`,
        lineId: line.id,
        lineName: line.name,
        color: line.color,
        direction,
        destination: direction === 0 ? geo.stations[geo.stations.length - 1].name : geo.stations[0].name,
        distance,
        speedKph,
        nextStationId: raw.nextStationId || next.id,
        nextStationName: next.name,
        etaSec,
        progress: Math.max(0, Math.min(1, distance / Math.max(1, geo.length))),
        atStation: speedKph < 0.5,
        departedAt: 0,
      });
    }
    if (!trains.length) {
      return {
        trains: simulated,
        kind: 'simulated',
        label: '模拟班次（实时源无数据）',
        asOf: simulatedAsOf,
        error: this.error,
      };
    }
    return {
      trains,
      kind: 'http',
      label: this.snapshot!.source ? `实时 · ${this.snapshot!.source}` : '外部实时数据',
      asOf: this.snapshot!.asOf ?? this.snapshotAt,
      error: null,
    };
  }
}
