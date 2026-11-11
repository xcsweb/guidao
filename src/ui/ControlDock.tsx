import type { ViewerApi } from '@/state/api';
import type { LayerState, Quality } from '@/state/store';
import { setUndergroundXray, useAppState } from '@/state/store';
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
    <>
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
          <button
            type="button"
            className={`chip chip-toggle${state.undergroundXray ? ' is-active' : ''}`}
            onClick={() => setUndergroundXray(!state.undergroundXray)}
            disabled={disabled}
            aria-pressed={state.undergroundXray}
            title="近景时透过地形显示地下线路，总览时不叠加"
          >
            地下线路透视
          </button>
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

      <div
        className="map-navigation glass-panel"
        aria-label="地图导航"
        title="左键单击选择站点；中键或左键拖动旋转；Shift+中键或右键拖动平移；Alt+左键旋转；滚轮向光标缩放"
      >
        <div className="map-zoom-buttons">
          <button
            type="button"
            onClick={() => api?.zoomBy(0.78)}
            disabled={disabled || !!state.follow || !!state.platformStation}
            aria-label="放大地图"
            title="放大（+）"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => api?.zoomBy(1.28)}
            disabled={disabled || !!state.follow || !!state.platformStation}
            aria-label="缩小地图"
            title="缩小（-）"
          >
            −
          </button>
        </div>
        <span className="map-nav-divider" aria-hidden="true" />
        <span className="map-gesture-hint">中键旋转 · Shift+中键 / 右键平移 · Alt+左键旋转 · 滚轮缩放</span>
        <span className="map-touch-hint">单指旋转 · 双指缩放与平移</span>
      </div>
    </>
  );
}
