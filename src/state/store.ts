import { useSyncExternalStore } from 'react';
import type {
  CityManifest,
  CityRegistry,
  LineData,
  StationData,
} from '@/data/types';

export type Quality = 'low' | 'medium' | 'high';

export interface TrainInfo {
  id: string;
  lineId: string;
  lineName: string;
  color: string;
  direction: 0 | 1;
  destination: string;
  nextStation: string;
  etaSec: number;
  speedKph: number;
  distance: number;
  progress: number;
}

export interface LineSummary {
  id: string;
  ref: string;
  name: string;
  color: string;
  lengthKm: number;
  stations: number;
  termini: [string, string];
}

export interface LayerState {
  buildings: boolean;
  water: boolean;
  labels: boolean;
  trains: boolean;
}

export interface AppState {
  phase: 'boot' | 'loading' | 'ready' | 'error';
  stage: string;
  progress: number;
  error: string | null;
  registry: CityRegistry | null;
  manifest: CityManifest | null;
  lines: LineSummary[];
  selectedLineId: string | null;
  trains: TrainInfo[];
  follow: TrainInfo | null;
  sim: {
    timeSec: number;
    multiplier: number;
    paused: boolean;
  };
  quality: Quality;
  exaggeration: number;
  layers: LayerState;
  stats: {
    fps: number;
    drawCalls: number;
    triangles: number;
    chunks: number;
  };
  statsVisible: boolean;
  station: StationData | null;
  followTunnel: boolean;
  source: {
    kind: 'simulated' | 'http';
    label: string;
    asOf: number;
  };
  toast: string | null;
}

const initialState: AppState = {
  phase: 'boot',
  stage: '准备中',
  progress: 0,
  error: null,
  registry: null,
  manifest: null,
  lines: [],
  selectedLineId: null,
  trains: [],
  follow: null,
  sim: { timeSec: 7 * 3600 + 30 * 60, multiplier: 10, paused: false },
  quality: 'medium',
  exaggeration: 1,
  layers: { buildings: true, water: true, labels: true, trains: true },
  stats: { fps: 0, drawCalls: 0, triangles: 0, chunks: 0 },
  statsVisible: false,
  station: null,
  followTunnel: false,
  source: { kind: 'simulated', label: '模拟班次', asOf: 0 },
  toast: null,
};

class Store {
  private state: AppState = initialState;
  private listeners = new Set<() => void>();
  private frame = 0;
  private pending: Partial<AppState> | null = null;

  getSnapshot = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  patch(partial: Partial<AppState>, immediate = false): void {
    this.pending = { ...(this.pending || {}), ...partial };
    if (immediate) {
      this.flush();
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }

  private flush(): void {
    if (!this.pending) return;
    this.state = { ...this.state, ...this.pending };
    this.pending = null;
    for (const listener of this.listeners) listener();
  }

  reset(partial: Partial<AppState>): void {
    this.pending = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.state = { ...initialState, ...partial };
    for (const listener of this.listeners) listener();
  }
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function lineSummaries(lines: LineData[]): LineSummary[] {
  return lines.map((l) => ({
    id: l.id,
    ref: l.ref,
    name: l.name,
    color: l.color,
    lengthKm: Number((l.length / 1000).toFixed(1)),
    stations: l.stations.length,
    termini: l.termini,
  }));
}

export function formatClock(timeSec: number): string {
  const t = ((timeSec % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t - h * 3600) / 60);
  const s = Math.floor(t - h * 3600 - m * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}
