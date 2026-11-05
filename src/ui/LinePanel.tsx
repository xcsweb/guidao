import type { CSSProperties } from 'react';
import type { ViewerApi } from '@/state/api';
import { useAppState } from '@/state/store';
import { CollapseIcon, GridIcon } from './Icons';

interface LinePanelProps {
  api: ViewerApi | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
}

export function LinePanel({ api, open, onToggle, onSelect }: LinePanelProps) {
  const state = useAppState();
  const { lines, selectedLineId } = state;
  const selectLine = (id: string | null) => {
    if (!api) return;
    api.selectLine(id);
    onSelect(id);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="panel-rail panel-rail-left glass-panel"
        onClick={onToggle}
        aria-label="展开运营线路面板"
        aria-expanded={false}
      >
        <span className="rail-icon" aria-hidden="true">
          <GridIcon width={18} height={18} />
        </span>
        <span className="rail-text">线路</span>
        <span className="rail-count">{lines.length}</span>
      </button>
    );
  }

  return (
    <aside className="side-panel line-panel glass-panel" aria-label="运营线路">
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-kicker">线网总览</span>
          <h2>运营线路</h2>
          <span className="panel-count">{lines.length} 条</span>
        </div>
        <button
          type="button"
          className="icon-btn is-quiet"
          onClick={onToggle}
          aria-label="收起线路面板"
          aria-expanded
        >
          <CollapseIcon />
        </button>
      </div>

      <div className="panel-scroll">
        <button
          type="button"
          className={`all-lines-row${selectedLineId === null ? ' is-active' : ''}`}
          onClick={() => selectLine(null)}
          disabled={!api}
          aria-pressed={selectedLineId === null}
        >
          <span className="all-lines-icon" aria-hidden="true">
            <GridIcon width={18} height={18} />
          </span>
          <span className="all-lines-text">
            <strong>全线路网</strong>
            <small>纵览全部 {lines.length} 条线路</small>
          </span>
        </button>

        <ul className="line-list">
          {lines.map((line) => {
            const active = selectedLineId === line.id;
            return (
              <li key={line.id}>
                <button
                  type="button"
                  className={`line-row${active ? ' is-active' : ''}`}
                  style={{ '--line-color': line.color } as CSSProperties}
                  onClick={() => selectLine(active ? null : line.id)}
                  disabled={!api}
                  aria-pressed={active}
                  title={`${line.name}：${line.termini[0]} ↔ ${line.termini[1]}`}
                >
                  <span className="line-bar" aria-hidden="true" />
                  <span className="line-main">
                    <span className="line-title">
                      <strong>{line.name}</strong>
                      <span className="line-ref">{line.ref}</span>
                    </span>
                    <span className="line-termini">
                      {line.termini[0]} ↔ {line.termini[1]}
                    </span>
                  </span>
                  <span className="line-meta">
                    <span>{line.stations} 站</span>
                    <span>{line.lengthKm} km</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
