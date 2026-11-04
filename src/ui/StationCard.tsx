import type { CSSProperties } from 'react';
import type { ViewerApi } from '@/state/api';
import { store, useAppState } from '@/state/store';
import { CloseIcon, TargetIcon } from './Icons';

interface StationCardProps {
  api: ViewerApi | null;
}

export function StationCard({ api }: StationCardProps) {
  const state = useAppState();
  const station = state.station;
  if (!station) return null;

  const lines = station.lines
    .map((id) => {
      const line = state.lines.find((item) => item.id === id);
      return {
        id,
        name: line?.name ?? id,
        color: line?.color ?? '#8ea4b6',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return (
    <section className="station-card glass-panel" aria-label={`${station.name}站点信息`}>
      <div className="station-head">
        <div>
          <span className="panel-kicker">站点详情</span>
          <h2>{station.name}</h2>
        </div>
        <button
          type="button"
          className="icon-btn is-quiet"
          onClick={() => store.patch({ station: null })}
          aria-label="关闭站点信息"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      <div className="station-lines">
        {lines.map((line) => (
          <span
            key={line.id}
            className="line-chip"
            style={{ '--line-color': line.color } as CSSProperties}
          >
            <i aria-hidden="true" />
            {line.name}
          </span>
        ))}
      </div>

      <dl className="station-meta">
        <div>
          <dt>经度</dt>
          <dd>{station.lon.toFixed(6)}</dd>
        </div>
        <div>
          <dt>纬度</dt>
          <dd>{station.lat.toFixed(6)}</dd>
        </div>
        <div>
          <dt>高程</dt>
          <dd>
            {station.elevation !== undefined ? `${Math.round(station.elevation)} m` : '—'}
          </dd>
        </div>
      </dl>

      <div className="station-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => api?.focusStation(station.id)}
          disabled={!api}
        >
          <TargetIcon width={14} height={14} />
          飞至该站
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => store.patch({ station: null })}
        >
          关闭
        </button>
      </div>
    </section>
  );
}
