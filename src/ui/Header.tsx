import { useRef } from 'react';
import type { ViewerApi } from '@/state/api';
import { formatClock, useAppState } from '@/state/store';
import { StatsIcon } from './Icons';
import { showToast } from './Toast';

interface HeaderProps {
  api: ViewerApi | null;
}

export function Header({ api }: HeaderProps) {
  const state = useAppState();
  const { registry, manifest, source, sim } = state;
  const currentId = manifest?.id ?? registry?.defaultCity ?? '';
  const selectRef = useRef<HTMLSelectElement>(null);
  const cityName =
    registry?.cities.find((city) => city.id === currentId)?.name ?? manifest?.name ?? '重庆';

  const onCityChange = (value: string) => {
    if (value === currentId) return;
    // 目前仅内置单一城市数据，切换请求统一以降级提示处理。
    if (selectRef.current) selectRef.current.value = currentId;
    showToast('更多城市数据筹备中');
  };

  const toggleStats = () => {
    if (!api) return;
    api.setStatsVisible(!state.statsVisible);
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="13.2"
              fill="none"
              stroke="rgba(95, 211, 196, 0.38)"
              strokeWidth="1"
            />
            <path
              d="M5.2 22.4c5-2.3 7.2-9.6 10.8-11.3 3 1.8 4.4 7.2 10.2 9.4"
              fill="none"
              stroke="#5fd3c4"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M5.6 26.2c6-2.1 8-10.2 11.8-12.2 3.1 1.4 4.4 7.2 9 9.1"
              fill="none"
              stroke="#f6a800"
              strokeWidth="1.3"
              strokeLinecap="round"
              opacity=".8"
            />
            <circle cx="16" cy="11.1" r="2.3" fill="#f6a800" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>山城轨道</h1>
          <p className="brand-sub">CHONGQING TRANSIT · 3D</p>
        </div>
      </div>

      <div className="header-cluster">
        <label className="city-select-wrap">
          <span className="sr-only">选择城市</span>
          <span className="city-select-label">城市</span>
          <select
            ref={selectRef}
            className="city-select"
            value={currentId}
            onChange={(event) => onCityChange(event.target.value)}
            aria-label="选择城市"
          >
            {(registry?.cities ?? []).map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
            <option value="__more__">更多城市 · 筹备中</option>
          </select>
          <span className="select-caret" aria-hidden="true">
            ▾
          </span>
        </label>

        <div className="clock" title={`${cityName}模拟时钟`}>
          <span className={`clock-dot${sim.paused ? ' is-paused' : ''}`} aria-hidden="true" />
          <time className="clock-value" dateTime={formatClock(sim.timeSec)}>
            {formatClock(sim.timeSec)}
          </time>
          {sim.paused && <span className="clock-paused">已暂停</span>}
        </div>

        <span
          className={`source-badge is-${source.kind}`}
          title={`${source.kind === 'http' ? '外部实时数据源' : '班次表模拟数据源'}：${source.label}`}
        >
          <i className="source-dot" aria-hidden="true" />
          {source.kind === 'http' ? '实时' : '模拟'}
          <span className="source-label">{source.label}</span>
        </span>

        <button
          type="button"
          className={`icon-btn stats-toggle${state.statsVisible ? ' is-active' : ''}`}
          onClick={toggleStats}
          disabled={!api}
          aria-pressed={state.statsVisible}
          title="显示或隐藏渲染统计"
        >
          <StatsIcon />
          <span className="btn-text">性能</span>
        </button>
      </div>
    </header>
  );
}
