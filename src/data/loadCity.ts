import type {
  CityManifest,
  CityRegistry,
  CityRegistryEntry,
  FeaturesFile,
  NetworkFile,
  TerrainMeta,
} from './types';

export interface LoadedCity {
  manifest: CityManifest;
  network: NetworkFile;
  terrainMeta: TerrainMeta;
  terrainBuffers: Int16Array[];
  features: FeaturesFile;
  buildings: Float32Array;
}

export type ProgressFn = (stage: string, pct: number) => void;

const DATA_ROOT = `${import.meta.env.BASE_URL}data`;

export async function loadRegistry(): Promise<CityRegistry> {
  const res = await fetch(`${DATA_ROOT}/cities.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`城市注册表加载失败 (HTTP ${res.status})`);
  return (await res.json()) as CityRegistry;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`资源加载失败 ${url} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`资源加载失败 ${url} (HTTP ${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (len && received > len * 4) break;
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export async function loadCity(entry: CityRegistryEntry, onProgress: ProgressFn): Promise<LoadedCity> {
  const base = `${DATA_ROOT}/${entry.manifest.replace(/[^/]+$/, '')}`;
  onProgress('城市清单', 2);
  const manifest = await fetchJson<CityManifest>(`${DATA_ROOT}/${entry.manifest}`);

  onProgress('线网数据', 8);
  const network = await fetchJson<NetworkFile>(base + manifest.assets.network);

  onProgress('地形元数据', 14);
  const terrainMeta = await fetchJson<TerrainMeta>(base + manifest.assets.terrain);

  const totalTiers = terrainMeta.tiers.length;
  const terrainBuffers: Int16Array[] = [];
  for (let i = 0; i < totalTiers; i++) {
    const tier = terrainMeta.tiers[i];
    onProgress(`地形高程 ${i + 1}/${totalTiers}`, 18 + Math.round((i / totalTiers) * 48));
    const buf = await fetchBuffer(base + tier.file);
    const arr = new Int16Array(buf);
    if (arr.length !== tier.width * tier.height) {
      throw new Error(`地形数据尺寸不匹配：${tier.file} (${arr.length} vs ${tier.width * tier.height})`);
    }
    terrainBuffers.push(arr);
  }

  onProgress('水系与建筑索引', 72);
  const features = await fetchJson<FeaturesFile>(base + manifest.assets.features);
  const buildingsBuf = await fetchBuffer(base + features.buildings.file);
  const buildings = new Float32Array(buildingsBuf);
  if (buildings.length !== features.buildings.count * features.buildings.stride) {
    throw new Error('建筑数据长度不匹配');
  }

  onProgress('构建场景', 96);
  return { manifest, network, terrainMeta, terrainBuffers, features, buildings };
}
