import type { CSSProperties } from 'react';
import type { ViewerApi } from '@/state/api';
import { store, useAppState, directionLabel, formatClockAbs, formatDuration } from '@/state/store';
import { CloseIcon, TargetIcon } from './Icons';

interface StationCardProps {
  api: ViewerApi | null;
}

function callStateLabel(state: 'approaching' | 'dwelling' | 'departing', etaSec: number): string {
  if (state === 'dwelling') return '停站中';
  if (state === 'departing') return '刚出站';
  return etaSec < 60 ? '即将进站' : '驶向本站';
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

  const calls = state.stationBoard;
  const live = state.source.kind === 'http';

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
          onClick={() => store.patch({ station: null, stationBoard: [] })}
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
        {station.stationType && (
          <span
            className={`station-kind is-${station.stationType}`}
            title="根据车站所在轨道的地上、地下区间自动判断"
          >
            {station.stationType === 'underground'
              ? '地下站'
              : station.stationType === 'mixed'
                ? '地上 / 地下混合'
                : '地面 / 高架站'}
          </span>
        )}
      </div>

      <div className="station-board">
        <div className="station-board-head">
          <span>到发预告</span>
          <small>{live ? '实时源' : '班次推演'}</small>
        </div>
        {calls.length === 0 ? (
          <p className="station-board-empty">当前时段暂无到站列车</p>
        ) : (
          <ul className="station-board-list">
            {calls.slice(0, 6).map((call) => {
              const key = `${call.lineId}-${call.direction}-${call.arrivalSec}`;
              return (
                <li key={key} className={`station-call is-${call.state}`}>
                  <span className="station-call-color" style={{ background: call.color }} aria-hidden="true" />
                  <div className="station-call-main">
                    <div className="station-call-dest">
                      往 {call.destination}
                      <em>
                        {call.lineName} · {directionLabel(call.direction)} · {call.trainCode}
                      </em>
                    </div>
                    <div className="station-call-time">
                      {formatClockAbs(call.arrivalSec)} 到站
                      {call.state === 'approaching' && call.etaSec > 0
                        ? ` · ${formatDuration(call.etaSec)}`
                        : ''}
                    </div>
                  </div>
                  <span className="station-call-state">
                    {callStateLabel(call.state, call.etaSec)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
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
          onClick={() => store.patch({ station: null, stationBoard: [] })}
        >
          关闭
        </button>
      </div>
    </section>
  );
}
