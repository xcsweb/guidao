import { useAppState } from '@/state/store';

export function LoadingOverlay() {
  const state = useAppState();
  if (state.phase === 'ready') return null;

  const failed = state.phase === 'error';
  const percent = Math.min(100, Math.max(0, Math.round(state.progress)));
  const cityName =
    state.manifest?.name ??
    state.registry?.cities.find((city) => city.id === state.registry?.defaultCity)?.name ??
    '重庆';

  return (
    <div className={`loading-overlay${failed ? ' is-error' : ''}`} role="status" aria-live="polite">
      <div className="loading-grid" aria-hidden="true" />
      <div className="loading-mountains" aria-hidden="true" />
      <div className="loading-glow" aria-hidden="true" />

      <div className="loading-card">
        {failed ? (
          <>
            <div className="loading-logo is-error" aria-hidden="true">
              <span className="loading-ring" />
              <span className="loading-core" />
            </div>
            <span className="loading-kicker">数据中断</span>
            <h1 className="loading-title">加载失败</h1>
            <p className="loading-error">{state.error ?? '未知错误，请稍后重试。'}</p>
            <button
              type="button"
              className="retry-btn"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <p className="loading-tip">若问题持续，请确认本机可访问 /data 下的城市数据资源。</p>
          </>
        ) : (
          <>
            <div className="loading-logo" aria-hidden="true">
              <span className="loading-ring" />
              <span className="loading-ring is-inner" />
              <span className="loading-core" />
            </div>
            <span className="loading-kicker">重庆轨道交通 · 三维</span>
            <h1 className="loading-title">山城轨道</h1>
            <p className="loading-sub">
              正在构建 {cityName} 数字孪生场景
            </p>
            <div className="loading-stage">
              <span>{state.stage || '准备中'}</span>
              <span className="loading-percent">{percent}%</span>
            </div>
            <div className="loading-bar">
              <span className="loading-bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="loading-tip">高程地形 · 全线路网 · 列车班次模拟</p>
          </>
        )}
      </div>
    </div>
  );
}
