import { useAppState } from '@/state/store';

export function Attribution() {
  const state = useAppState();
  const osmUrl = state.manifest?.attribution.osmUrl ?? 'https://www.openstreetmap.org/copyright';
  const terrainUrl =
    state.manifest?.attribution.terrainUrl ?? 'https://registry.opendata.aws/terrain-tiles/';

  return (
    <footer className="attribution">
      <span>
        线网/建筑 ©{' '}
        <a href={osmUrl} target="_blank" rel="noreferrer">
          OpenStreetMap 贡献者
        </a>{' '}
        · ODbL
      </span>
      <span className="attribution-sep" aria-hidden="true">
        |
      </span>
      <span>
        高程{' '}
        <a href={terrainUrl} target="_blank" rel="noreferrer">
          Terrarium / AWS Open Data
        </a>
      </span>
      <span className="attribution-sep" aria-hidden="true">
        |
      </span>
      <span>列车为班次模拟</span>
    </footer>
  );
}
