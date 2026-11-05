import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDownloaded } from './lib/download.mjs';
import { makeProjection } from './lib/geo.mjs';
import { extractOsm } from './lib/osm.mjs';
import { bakeTerrain } from './lib/terrain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cityId = (args.find((a) => a.startsWith('--city=')) || '--city=cq').split('=')[1];
const skipTerrain = args.includes('--skip-terrain');
const cityPath = join(ROOT, 'scripts/cities', `${cityId}.json`);
const city = JSON.parse(readFileSync(cityPath, 'utf8'));
const outDir = join(ROOT, 'public/data', city.id);
const cacheDir = join(ROOT, '.cache');
const t0 = Date.now();

console.log(`\n=== 构建城市数据包：${city.name} (${city.id}) ===`);
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

console.log('\n[1/4] 下载 OpenStreetMap 重庆省级提取');
const pbfPath = join(cacheDir, 'chongqing.osm.pbf');
await ensureDownloaded(city.pbf, pbfPath, { minBytes: 1_000_000 });
console.log(`  · PBF ${(statSync(pbfPath).size / 1024 / 1024).toFixed(1)} MB`);

console.log('\n[2/4] 提取线网与地表要素');
const extracted = await extractOsm(pbfPath, city, { log: console.log });

console.log('\n[3/4] 烘焙地形高程');
let terrainMeta;
if (skipTerrain && existsSync(join(outDir, 'terrain.json'))) {
  terrainMeta = JSON.parse(readFileSync(join(outDir, 'terrain.json'), 'utf8'));
  console.log('  · 复用已有 terrain.json');
} else {
  terrainMeta = await bakeTerrain(city, outDir, cacheDir, console.log);
}

console.log('\n[4/4] 写入数据包');
const projection = makeProjection(city.center[0], city.center[1]);
const boundsLocal = [
  projection.toLocal(city.bbox[0], city.bbox[3])[0],
  projection.toLocal(city.bbox[0], city.bbox[3])[1],
  projection.toLocal(city.bbox[2], city.bbox[1])[0],
  projection.toLocal(city.bbox[2], city.bbox[1])[1],
];

const network = {
  lines: extracted.lines,
  stations: extracted.stations,
  service: city.service,
};
writeJson(join(outDir, 'network.json'), network);

const buildings = extracted.buildings;
const buildingBuf = new Float32Array(buildings.length * 6);
buildings.forEach((b, i) => buildingBuf.set(b, i * 6));
writeFileSync(join(outDir, 'buildings.bin'), Buffer.from(buildingBuf.buffer, buildingBuf.byteOffset, buildingBuf.byteLength));

const features = {
  rivers: extracted.rivers,
  buildings: {
    file: 'buildings.bin',
    count: buildings.length,
    stride: 6,
  },
};
writeJson(join(outDir, 'features.json'), features);

const minH = Math.min(...terrainMeta.tiers.map((t) => t.minH));
const maxH = Math.max(...terrainMeta.tiers.map((t) => t.maxH));
const manifest = {
  schemaVersion: 1,
  id: city.id,
  name: city.name,
  subtitle: city.subtitle,
  bbox: city.bbox,
  center: city.center,
  projection: {
    lon0: projection.lon0,
    lat0: projection.lat0,
    mPerDegLon: projection.mPerDegLon,
    mPerDegLat: projection.mPerDegLat,
  },
  elevation: {
    min: Math.max(40, Math.round(minH)),
    max: Math.min(3200, Math.round(maxH)),
    defaultExaggeration: 1,
    exaggerationRange: [0.5, 3],
  },
  boundsLocal: boundsLocal.map((v) => Math.round(v)),
  assets: {
    network: 'network.json',
    terrain: 'terrain.json',
    features: 'features.json',
    buildings: 'buildings.bin',
  },
  counts: {
    lines: network.lines.length,
    stations: network.stations.length,
    buildings: buildings.length,
    rivers: extracted.rivers.length,
    trackPoints: network.lines.reduce((sum, l) => sum + l.path.length / 2, 0),
  },
  attribution: {
    osm: '线网/建筑/水系 © OpenStreetMap 贡献者 (ODbL)',
    osmUrl: 'https://www.openstreetmap.org/copyright',
    terrain: '高程数据：Terrarium / AWS Open Data (SRTM, GEBCO 等)',
    terrainUrl: 'https://registry.opendata.aws/terrain-tiles/',
    realtime: '列车位置为班次表模拟数据，可通过配置接入外部实时源',
  },
  generatedAt: new Date().toISOString(),
};
writeJson(join(outDir, 'manifest.json'), manifest);

mkdirSync(join(ROOT, 'public/data'), { recursive: true });
writeJson(join(ROOT, 'public/data/cities.json'), {
  defaultCity: city.id,
  cities: [
    {
      id: city.id,
      name: city.name,
      subtitle: city.subtitle,
      manifest: `${city.id}/manifest.json`,
    },
  ],
});

const report = buildReport(network, manifest, extracted);
writeJson(join(outDir, 'report.json'), report);

const sizes = {};
for (const f of [
  'manifest.json',
  'network.json',
  'features.json',
  'buildings.bin',
  'terrain.json',
  ...terrainMeta.tiers.map((t) => t.file),
]) {
  const p = join(outDir, f);
  if (existsSync(p)) sizes[f] = (statSync(p).size / 1024 / 1024).toFixed(2) + ' MB';
}

console.log('\n=== 构建完成 ===');
console.log(
  `线路 ${manifest.counts.lines} 条 · 车站 ${manifest.counts.stations} 座 · 建筑 ${manifest.counts.buildings} 栋 · 河流 ${manifest.counts.rivers} 段`,
);
console.log(`高程 ${manifest.elevation.min}–${manifest.elevation.max} m · 用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k}: ${v}`);
if (report.warnings.length) {
  console.log('\n警告:');
  for (const w of report.warnings) console.log(`  ! ${w}`);
}
if (report.fatal.length) {
  console.error('\n校验失败:');
  for (const f of report.fatal) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log('\n校验通过：线网完整、坐标在范围内、车站序列有效。');
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data));
}

function buildReport(network, manifest, extracted) {
  const warnings = [...extracted.warnings];
  const fatal = [];

  if (network.lines.length < 10) fatal.push(`线路数量不足：${network.lines.length} (<10)`);
  if (network.stations.length < 200) fatal.push(`车站数量不足：${network.stations.length} (<200)`);

  for (const line of network.lines) {
    if (line.path.length < 6) fatal.push(`${line.name} 轨道点不足`);
    if (line.stations.length < 2) fatal.push(`${line.name} 车站不足`);
    let maxGap = 0;
    for (let i = 2; i < line.path.length; i += 2) {
      maxGap = Math.max(maxGap, Math.hypot(line.path[i] - line.path[i - 2], line.path[i + 1] - line.path[i - 1]));
    }
    if (maxGap > 10_000) fatal.push(`${line.name} 轨道断裂 ${(maxGap / 1000).toFixed(1)} km`);
    else if (maxGap > 3_000) {
      warnings.push(`${line.name} 最长轨道段 ${(maxGap / 1000).toFixed(1)} km（OSM 稀疏几何）`);
    }
    const names = new Set();
    let previousDist = -Infinity;
    for (const st of line.stations) {
      if (!Number.isFinite(st.dist)) fatal.push(`${line.name} 车站 ${st.name} 距离无效`);
      if (st.dist < previousDist) fatal.push(`${line.name} 车站 ${st.name} 里程倒序`);
      if (names.has(st.name)) fatal.push(`${line.name} 车站 ${st.name} 重复`);
      names.add(st.name);
      previousDist = st.dist;
    }
  }

  for (const st of network.stations) {
    if (st.lon < manifest.bbox[0] || st.lon > manifest.bbox[2] || st.lat < manifest.bbox[1] || st.lat > manifest.bbox[3]) {
      fatal.push(`车站越界：${st.name} (${st.lon}, ${st.lat})`);
    }
  }

  for (const line of network.lines) {
    const prev = line.stations[line.stations.length - 1];
    if (prev && prev.dist < 0) fatal.push(`${line.name} 车站距离为负`);
  }

  return {
    generatedAt: manifest.generatedAt,
    counts: manifest.counts,
    lines: network.lines.map((l) => ({
      id: l.id,
      name: l.name,
      stations: l.stations.length,
      lengthKm: Number((l.length / 1000).toFixed(1)),
      points: l.path.length / 2,
      bridges: l.surface.bridge.length,
      tunnels: l.surface.tunnel.length,
    })),
    warnings,
    fatal,
  };
}
