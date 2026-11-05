import type { Quality, LayerState } from './store';

export interface ViewerApi {
  selectLine(id: string | null): void;
  followTrain(id: string): void;
  exitFollow(): void;
  togglePause(): void;
  setMultiplier(value: number): void;
  setQuality(quality: Quality): void;
  setExaggeration(value: number): void;
  setLayer(key: keyof LayerState, value: boolean): void;
  focusStation(id: string): void;
  resetView(): void;
  setStatsVisible(value: boolean): void;
  flyToLine(id: string | null): void;
  zoomBy(factor: number): void;
}
