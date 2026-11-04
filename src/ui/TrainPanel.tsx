import type { CSSProperties } from 'react';
import type { ViewerApi } from '@/state/api';
import { formatDuration, useAppState } from '@/state/store';
import { ClockIcon, CloseIcon, TrainIcon } from './Icons';

interface TrainPanelProps {
  api: ViewerApi | null;
  open: boolean;
  onToggle: () => void;
}

function trainCode(id: string): string {
  const parts = id.split('-');
  return parts[parts.length - 1] || id;
}

function progressPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100)));
}

export function TrainPanel({ api, open, onToggle }: TrainPanelProps) {
  const state = useAppState();
  const line = state.lines.find((item) => item.id === state.selectedLineId);
  if (!line) return null;

  const trains = state.trains.filter((train) => train.lineId === line.id);
  const followedId = state.follow?.id ?? null;

  if (!open) {
    return (
      <button
        type="button"
        className="panel-rail panel-rail-right glass-panel"
        onClick={onToggle}
        aria-label="展开列车运行面板"
        aria-expanded={false}
      >
        <span className="rail-icon" aria-hidden="true">
          <TrainIcon width={18} height={18} />
        </span>
        <span className="rail-text">列车</span>
        <span className="rail-count">{trains.length}</span>
      </button>
    );
  }

  return (
    <aside
      className="side-panel train-panel glass-panel"
      aria-label={`${line.name}列车运行`}
      style={{ '--line-color': line.color } as CSSProperties}
    >
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-kicker">运行列车</span>
          <h2>
            <span className="title-accent" aria-hidden="true" />
            {line.name}
          </h2>
          <span className="panel-count">运行中列车 {trains.length} 班</span>
        </div>
        <button
          type="button"
          className="icon-btn is-quiet"
          onClick={onToggle}
          aria-label="收起列车面板"
          aria-expanded
        >
          <CloseIcon />
        </button>
      </div>

      <div className="panel-scroll">
        {trains.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <ClockIcon width={22} height={22} />
            </span>
            <h3>当前时段暂无运行列车</h3>
            <p>
              运营时段为 <strong>06:00–23:00</strong>。可在底部控制台提高时间倍率（
              <strong>10× / 60×</strong>），继续推进班次。
            </p>
          </div>
        ) : (
          <ul className="train-list">
            {trains.map((train) => {
              const followed = train.id === followedId;
              const pct = progressPercent(train.progress);
              return (
                <li key={train.id}>
                  <div className={`train-row${followed ? ' is-followed' : ''}`}>
                    <div className="train-row-head">
                      <span className="train-code">#{trainCode(train.id)}</span>
                      <span className="train-dest">往 {train.destination}</span>
                      <button
                        type="button"
                        className={`follow-btn${followed ? ' is-active' : ''}`}
                        onClick={() => api?.followTrain(train.id)}
                        disabled={!api}
                        aria-pressed={followed}
                      >
                        {followed ? '跟随中' : '跟随'}
                      </button>
                    </div>
                    <div className="train-row-sub">
                      <span className="train-next">下一站 {train.nextStation}</span>
                      <span className="train-eta">{formatDuration(train.etaSec)}</span>
                    </div>
                    <div className="train-bar" aria-hidden="true">
                      <span
                        className="train-bar-fill"
                        style={{ width: `${pct}%`, background: train.color }}
                      />
                    </div>
                    <div className="train-meta">
                      <span>{Math.round(train.speedKph)} km/h</span>
                      <span>{pct}%</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
