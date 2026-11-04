import { useState, type CSSProperties } from 'react';
import type { ViewerApi } from '@/state/api';
import {
  TRAIN_STATUS_LABEL,
  directionLabel,
  formatClockAbs,
  formatDuration,
  useAppState,
} from '@/state/store';
import { ClockIcon, CloseIcon, TrainIcon } from './Icons';

interface TrainPanelProps {
  api: ViewerApi | null;
  open: boolean;
  onToggle: () => void;
}

function progressPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100)));
}

export function TrainPanel({ api, open, onToggle }: TrainPanelProps) {
  const state = useAppState();
  const [tab, setTab] = useState<'trains' | 'timetable'>('trains');
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
          <span className="panel-kicker">运行组织</span>
          <h2>
            <span className="title-accent" aria-hidden="true" />
            {line.name}
          </h2>
          <span className="panel-count">
            {line.termini[0]} ↔ {line.termini[1]}
          </span>
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

      <div className="panel-tabs" role="tablist" aria-label="列车面板视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'trains'}
          className={`panel-tab${tab === 'trains' ? ' is-active' : ''}`}
          onClick={() => setTab('trains')}
        >
          运行列车
          <span className="panel-tab-count">{trains.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'timetable'}
          className={`panel-tab${tab === 'timetable' ? ' is-active' : ''}`}
          onClick={() => setTab('timetable')}
        >
          时刻表
        </button>
      </div>

      <div className="panel-scroll">
        {tab === 'trains' ? (
          trains.length === 0 ? (
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
                        <span className="train-code">#{train.code}</span>
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
                      <div className="train-status-line">
                        <span className={`train-status is-${train.status}`}>
                          {TRAIN_STATUS_LABEL[train.status]}
                        </span>
                        <span className="direction-chip">{directionLabel(train.direction)}</span>
                        <span className="train-arrival">
                          {train.nextArrivalSec > 0
                            ? `预计 ${formatClockAbs(train.nextArrivalSec)} 到站`
                            : '外部实时数据'}
                        </span>
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
          )
        ) : (
          <LineTimetablePanel />
        )}
      </div>
    </aside>
  );
}

function LineTimetablePanel() {
  const state = useAppState();
  const board = state.lineBoard;
  const sourceKind = state.source.kind;

  if (!board) {
    return (
      <div className="empty-state">
        <h3>时刻表载入中</h3>
        <p>请选择一条线路以查看当日运行图。</p>
      </div>
    );
  }

  const up = board.directions[0];
  const down = board.directions[1];

  return (
    <div className="tt-wrap">
      <div className="tt-source">
        <span className={`source-dot${sourceKind === 'http' ? ' is-live' : ''}`} aria-hidden="true" />
        <div>
          <strong>{sourceKind === 'http' ? '外部实时数据已接入' : '班次表推演数据'}</strong>
          <span>
            {sourceKind === 'http'
              ? '列车位置以实时源为准，到发时刻仍按运行图推算。'
              : '依据运营时段、高峰间隔与站间距离推演；官方未公开实时列车位置接口。'}
          </span>
        </div>
      </div>

      <div className="tt-departures">
        {board.directions.map((direction) => (
          <div className="tt-dir-block" key={direction.direction}>
            <div className="tt-dir-head">
              <span className="tt-dir-name">
                {directionLabel(direction.direction)} · 往 {direction.destination}
              </span>
              <span className="tt-dir-hint">始发时刻</span>
            </div>
            <div className="tt-departure-times">
              {direction.departures.length === 0 ? (
                <span className="tt-time is-empty">已收车</span>
              ) : (
                direction.departures.map((time, index) => (
                  <span key={`${direction.direction}-${time}`} className={`tt-time${index === 0 ? ' is-next' : ''}`}>
                    {formatClockAbs(time)}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="tt-table-head">
        <span>车站</span>
        <span>{directionLabel(up.direction)}</span>
        <span>{directionLabel(down.direction)}</span>
      </div>
      <ul className="tt-stations">
        {board.stations.map((station) => {
          const current = state.station?.id === station.id;
          return (
            <li key={station.id} className={`tt-station${current ? ' is-current' : ''}`}>
              <span className="tt-station-name">{station.name}</span>
              <span className="tt-arrivals">
                {station.arrivals[0].length === 0 ? (
                  <em>—</em>
                ) : (
                  station.arrivals[0].map((time, index) => (
                    <b key={`0-${time}`} className={index === 0 ? 'is-next' : undefined}>
                      {formatClockAbs(time)}
                    </b>
                  ))
                )}
              </span>
              <span className="tt-arrivals">
                {station.arrivals[1].length === 0 ? (
                  <em>—</em>
                ) : (
                  station.arrivals[1].map((time, index) => (
                    <b key={`1-${time}`} className={index === 0 ? 'is-next' : undefined}>
                      {formatClockAbs(time)}
                    </b>
                  ))
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="tt-foot">
        运营时段 {state.service ? `${formatClockAbs(state.service.startSec)}–${formatClockAbs(state.service.endSec)}` : '06:00–23:00'}
        {state.service
          ? ` · 高峰间隔 ${Math.round(state.service.headwayPeakSec / 60)} 分 / 平峰 ${Math.round(state.service.headwayOffSec / 60)} 分 · 停站 ${Math.round(state.service.dwellSec)} 秒`
          : ''}
      </p>
    </div>
  );
}
