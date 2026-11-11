import { useEffect, useRef, useState } from 'react';
import { loadCity, loadRegistry } from '@/data/loadCity';
import type { ViewerApi } from '@/state/api';
import { store, useAppState } from '@/state/store';
import { Viewer } from '@/viewer/Viewer';
import { Attribution } from './ui/Attribution';
import { ControlDock } from './ui/ControlDock';
import { FollowHud } from './ui/FollowHud';
import { Header } from './ui/Header';
import { LinePanel } from './ui/LinePanel';
import { LoadingOverlay } from './ui/LoadingOverlay';
import { PlatformHud, StationCard } from './ui/StationCard';
import { StatsPanel } from './ui/StatsPanel';
import { Toast, showToast } from './ui/Toast';
import { TrainPanel } from './ui/TrainPanel';

export function App() {
  const state = useAppState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [api, setApi] = useState<ViewerApi | null>(null);
  const [linePanelOpen, setLinePanelOpen] = useState(true);
  const [trainPanelOpen, setTrainPanelOpen] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const boot = async () => {
      try {
        store.patch({ phase: 'loading', stage: '连接城市数据', progress: 1, error: null }, true);
        const registry = await loadRegistry();
        if (cancelled) return;
        store.patch({ registry, phase: 'loading', stage: '城市注册表', progress: 4 }, true);

        const entry =
          registry.cities.find((city) => city.id === registry.defaultCity) ?? registry.cities[0];
        if (!entry) throw new Error('城市注册表中没有可用城市');

        const loaded = await loadCity(entry, (stage, pct) => {
          if (cancelled) return;
          store.patch({ phase: 'loading', stage, progress: pct });
        });
        if (cancelled || !canvasRef.current) return;

        const viewer = new Viewer(canvasRef.current, loaded);
        viewerRef.current = viewer;
        viewer.start();
        setApi(viewer.api);
        if (import.meta.env.DEV) {
          (window as unknown as { __api: ViewerApi }).__api = viewer.api;
        }
      } catch (err) {
        if (cancelled) return;
        store.patch(
          {
            phase: 'error',
            stage: '加载失败',
            error: err instanceof Error ? err.message : String(err),
          },
          true,
        );
      }
    };

    void boot();

    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        api?.togglePause();
        return;
      }

      if (event.key === 'l' || event.key === 'L') {
        setLinePanelOpen((open) => !open);
        return;
      }

      if (event.key === 'f' || event.key === 'F') {
        if (!api) return;
        const snapshot = store.getSnapshot();
        const preferred = snapshot.selectedLineId
          ? snapshot.trains.filter((item) => item.lineId === snapshot.selectedLineId)
          : snapshot.trains;
        const train = preferred[0] ?? snapshot.trains[0];
        if (train) {
          api.followTrain(train.id);
        } else {
          showToast('当前时段暂无可跟随的列车');
        }
        return;
      }

      if (event.key === '+' || event.key === '=' || event.key === '-') {
        event.preventDefault();
        api?.zoomBy(event.key === '-' ? 1.28 : 0.78);
        return;
      }

      if (event.key === 'Escape') {
        api?.exitFollow();
        api?.exitPlatformView();
        store.patch({ station: null });
        setLinePanelOpen(false);
        setTrainPanelOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api]);

  useEffect(() => {
    if (state.station && window.innerWidth <= 960) {
      setLinePanelOpen(false);
      setTrainPanelOpen(false);
    }
  }, [state.station]);

  const following = state.follow !== null;

  return (
    <div
      className={`app${following || state.platformStation ? ' is-following' : ''}${
        state.platformStation ? ' is-platform-view' : ''
      }${trainPanelOpen && state.selectedLineId ? ' is-train-panel-open' : ''}`}
    >
      <div className="scene-shell">
        <canvas id="scene" ref={canvasRef} aria-label="重庆轨道交通三维场景" />
      </div>

      <div className="ui-layer">
        <Header api={api} />
        <LinePanel
          api={api}
          open={linePanelOpen}
          onToggle={() => setLinePanelOpen((open) => !open)}
          onSelect={(id) => {
            if (id && window.innerWidth <= 960) {
              setLinePanelOpen(false);
              setTrainPanelOpen(true);
            }
          }}
        />
        <ControlDock api={api} />
        <TrainPanel
          api={api}
          open={trainPanelOpen}
          onToggle={() => setTrainPanelOpen((open) => !open)}
        />
        <FollowHud api={api} />
        <PlatformHud api={api} />
        <StatsPanel api={api} />
        <StationCard api={api} />
        <Attribution />
        <Toast />
      </div>

      {state.phase !== 'ready' && <LoadingOverlay />}
    </div>
  );
}
