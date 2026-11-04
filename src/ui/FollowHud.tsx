import type { ViewerApi } from '@/state/api';
import { formatDuration, useAppState } from '@/state/store';
import { CloseIcon, TrainIcon } from './Icons';

interface FollowHudProps {
  api: ViewerApi | null;
}

export function FollowHud({ api }: FollowHudProps) {
  const state = useAppState();
  const train = state.follow;
  if (!train) return null;

  const code = train.id.split('-').slice(-1)[0] || train.id;
  const pct = Math.min(100, Math.max(0, Math.round(train.progress * 100)));

  return (
    <>
      <div className="follow-vignette" aria-hidden="true" />
      {state.followTunnel && <div className="tunnel-veil" aria-hidden="true" />}
      <section className="follow-hud glass-panel" aria-label="列车跟随驾驶舱">
        <div className="follow-head">
          <span className="follow-accent" style={{ background: train.color }} aria-hidden="true" />
          <span className="follow-icon" aria-hidden="true">
            <TrainIcon width={16} height={16} />
          </span>
          <div className="follow-line-block">
            <span className="follow-line">{train.lineName}</span>
            <span className="follow-dest">往 {train.destination}</span>
          </div>
          <span className="follow-code">#{code}</span>
        </div>

        <div className="follow-speed">
          <span className="speed-value">{Math.round(train.speedKph)}</span>
          <span className="speed-unit">km/h</span>
          {state.followTunnel && <span className="tunnel-badge">隧道区间</span>}
        </div>

        <div className="follow-next">
          <span className="follow-next-label">下一站</span>
          <strong>{train.nextStation}</strong>
          <span className="follow-eta">{formatDuration(train.etaSec)}</span>
        </div>

        <div className="progress-track" aria-hidden="true">
          <span
            className="progress-fill"
            style={{ width: `${pct}%`, background: train.color }}
          />
        </div>

        <div className="follow-foot">
          <span className="follow-progress-text">行程 {pct}%</span>
          <button
            type="button"
            className="exit-follow"
            onClick={() => api?.exitFollow()}
            disabled={!api}
          >
            <CloseIcon width={13} height={13} />
            退出跟随
          </button>
        </div>
      </section>
    </>
  );
}
