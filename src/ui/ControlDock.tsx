import type { ViewerApi } from '@/state/api';
import type { LayerState, Quality } from '@/state/store';
import { useAppState } from '@/state/store';
import { PauseIcon, PlayIcon, ResetIcon } from './Icons';

interface ControlDockProps {
  api: ViewerApi | null;
}

const MULTIPLIERS = [1, 10, 60];
const QUALITIES: Array<{ value: Quality; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];
const LAYERS: Array<{ key: keyof LayerState; label: string }> = [
  { key: 'buildings', label: '建筑' },
  { key: 'water', label: '水系' },
  { key: 'labels', label: '站名' },
  { key: 'trains', label: '列车' },
];

export function ControlDock({ api }: ControlDockProps) {
  const state = useAppState();
  const { sim, quality, exaggeration, layers } = state;
  const disabled = !api;
  const exaggerationText = `×${exaggeration.toFixed(1)}`;

  return (
    <div className="control-dock glass-panel" role="toolbar" aria-label="场景控制">
      <button
        type="button"
        className={`dock-play${sim.paused ? ' is-paused' : ''}`}
        onClick={() => api?.togglePause()}
        disabled={disabled}
        aria-label={sim.paused ? '继续运行' : '暂停运行'}
        title={sim.paused ? '继续（空格）' : '暂停（空格）'}
      >
        {sim.paused ? <PlayIcon width={18} height={18} /> : <PauseIcon width={18} height={18} />}
      </button>

      <span className="dock-divider" aria-hidden="true" />

      <div className="dock-group" role="group" aria-label="时间倍率">
        <span className="dock-label">时间</span>
        <div className="chips">
          {MULTIPLIERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip${sim.multiplier === value ? ' is-active' : ''}`}
              onClick={() => api?.setMultiplier(value)}
              disabled={disabled}
              aria-pressed={sim.multiplier === value}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>

      <span className="dock-divider" aria-hidden="true" />

      <div className="dock-group" role="group" aria-label="画质">
        <span className="dock-label">画质</span>
        <div className="chips">
          {QUALITIES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip${quality === item.value ? ' is-active' : ''}`}
              onClick={() => api?.setQuality(item.value)}
              disabled={disabled}
              aria-pressed={quality === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <span className="dock-divider" aria-hidden="true" />

      <div className="dock-group slider-group">
        <label className="dock-label" htmlFor="exaggeration">
          高程夸张
        </label>
        <input
          id="exaggeration"
          className="dock-slider"
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={exaggeration}
          onChange={(event) => api?.setExaggeration(Number(event.target.value))}
          disabled={disabled}
        />
        <output className="slider-value" htmlFor="exaggeration">
          {exaggerationText}
        </output>
      </div>

      <span className="dock-divider" aria-hidden="true" />

      <div className="dock-group" role="group" aria-label="图层">
        <span className="dock-label">图层</span>
        <div className="chips">
          {LAYERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip chip-toggle${layers[item.key] ? ' is-active' : ''}`}
              onClick={() => api?.setLayer(item.key, !layers[item.key])}
              disabled={disabled}
              aria-pressed={layers[item.key]}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <span className="dock-divider" aria-hidden="true" />

      <button
        type="button"
        className="dock-reset"
        onClick={() => api?.resetView()}
        disabled={disabled}
        title="重置视角"
      >
        <ResetIcon width={15} height={15} />
        <span>重置视角</span>
      </button>
    </div>
  );
}
