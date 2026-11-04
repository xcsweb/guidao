import type { ViewerApi } from '@/state/api';
import type { Quality } from '@/state/store';
import { useAppState } from '@/state/store';
import { CloseIcon } from './Icons';

interface StatsPanelProps {
  api: ViewerApi | null;
}

const QUALITY_LABEL: Record<Quality, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

function formatWan(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return value.toLocaleString('zh-CN');
}

export function StatsPanel({ api }: StatsPanelProps) {
  const state = useAppState();
  if (!state.statsVisible) return null;

  const { fps, drawCalls, triangles, chunks } = state.stats;

  return (
    <section className="stats-panel glass-panel" aria-label="渲染统计">
      <div className="stats-head">
        <span className="panel-kicker">渲染统计</span>
        <button
          type="button"
          className="icon-btn is-quiet"
          onClick={() => api?.setStatsVisible(false)}
          disabled={!api}
          aria-label="隐藏渲染统计"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      <dl className="stats-grid">
        <div className="stat">
          <dt>帧率</dt>
          <dd>
            {fps}
            <small>fps</small>
          </dd>
        </div>
        <div className="stat">
          <dt>绘制调用</dt>
          <dd>{drawCalls}</dd>
        </div>
        <div className="stat">
          <dt>三角面</dt>
          <dd>{formatWan(triangles)}</dd>
        </div>
        <div className="stat">
          <dt>地形块</dt>
          <dd>
            {chunks}
            <small>块</small>
          </dd>
        </div>
        <div className="stat">
          <dt>列车</dt>
          <dd>
            {state.trains.length}
            <small>班</small>
          </dd>
        </div>
        <div className="stat">
          <dt>画质</dt>
          <dd>{QUALITY_LABEL[state.quality]}</dd>
        </div>
      </dl>
    </section>
  );
}
