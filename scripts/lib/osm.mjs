import { createReadStream } from 'node:fs';
import osmParser from 'osm-pbf-parser';
import {
  boundsOfPoints,
  cumulativeLengths,
  dedupeFlat,
  makeProjection,
  pathLength,
  projectPointOnPolyline,
  roundFlat,
  simplifyFlat,
} from './geo.mjs';

const ROUTE_TYPES = new Set(['subway', 'monorail', 'light_rail', 'train']);
const RAIL_TYPES = new Set(['subway', 'monorail', 'light_rail', 'rail', 'narrow_gauge']);

const LINE_META = {
  loop: { ref: '环', name: '环线', color: '#F6A800' },
  1: { ref: '1', name: '1号线', color: '#D7000F' },
  2: { ref: '2', name: '2号线', color: '#008239' },
  3: { ref: '3', name: '3号线', color: '#07287F' },
  '3-airport': { ref: '3', name: '3号线空港支线', color: '#07287F' },
  4: { ref: '4', name: '4号线', color: '#ED8E00' },
  5: { ref: '5', name: '5号线', color: '#0096DA' },
  6: { ref: '6', name: '6号线', color: '#DB5A7B' },
  '6-guobo': { ref: '6', name: '国博线', color: '#DB5A7B' },
  9: { ref: '9', name: '9号线', color: '#811C2A' },
  10: { ref: '10', name: '10号线', color: '#61279E' },
  18: { ref: '18', name: '18号线', color: '#1CD4C6' },
  jiangtiao: { ref: 'JT', name: '江跳线', color: '#0056B8' },
  bitong: { ref: 'BT', name: '璧铜线', color: '#0056B8' },
};

const RIVER_WIDTH = {
  长江: 700,
  嘉陵江: 320,
  乌江: 260,
  涪江: 220,
  渠江: 200,
  綦江: 150,
  龙溪河: 110,
  御临河: 110,
  大宁河: 120,
  阿蓬江: 110,
  郁江: 100,
  磨刀溪: 80,
  梅溪河: 90,
  塘河: 70,
  琼江: 80,
};

function isChongqingTransit(tags) {
  if (!ROUTE_TYPES.has(tags.route)) return false;
  const network = tags.network || '';
  const operator = tags.operator || '';
  const name = tags.name || '';
  if (name.includes('云巴')) return false;
  return (
    network.includes('重庆') ||
    operator.includes('重庆') ||
    name.includes('重庆') ||
    name.includes('轨道')
  );
}

function classifyRelation(tags) {
  const name = tags.name || '';
  const ref = (tags.ref || '').trim();
  if (!ref) return null;
  if (name.includes('快速') || name.includes('直通')) return null;
  if (name.includes('国博支线')) return { key: '6-guobo', loop: false };
  if (name.includes('空港支线')) return { key: '3-airport', loop: false };
  if (ref === '环') return { key: 'loop', loop: true };
  if (ref === 'JT') return { key: 'jiangtiao', loop: false };
  if (ref === 'BT') return { key: 'bitong', loop: false };
  if (/^\d+$/.test(ref) && LINE_META[ref]) return { key: ref, loop: false };
  return null;
}

function parseHeight(tags) {
  const raw = tags.height;
  if (raw) {
    const v = parseFloat(String(raw).replace(/[^\d.]/g, ''));
    if (Number.isFinite(v) && v > 0) return v;
  }
  const levels = parseFloat(String(tags['building:levels'] || ''));
  if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  return 14;
}

async function scan(pbfPath, label, onBatch) {
  return new Promise((resolve, reject) => {
    const parser = osmParser();
    let count = 0;
    parser.on('data', (items) => {
      count += items.length;
      onBatch(items);
    });
    parser.on('end', () => resolve(count));
    parser.on('error', reject);
    createReadStream(pbfPath).on('error', reject).pipe(parser);
  });
}

export async function extractOsm(pbfPath, city, { log = console.log } = {}) {
  const projection = makeProjection(city.center[0], city.center[1]);
  const bbox = city.bbox;

  log('  · 解析 route 关系…');
  const relations = [];
  await scan(pbfPath, 'relations', (items) => {
    for (const item of items) {
      if (item.type !== 'relation' || !item.tags) continue;
      const tags = item.tags;
      if (!isChongqingTransit(tags)) continue;
      relations.push({
        id: item.id,
        tags,
        members: (item.members || []).map((m) => ({
          type: m.type,
          ref: m.id ?? m.ref,
          role: m.role || '',
        })),
      });
    }
  });

  const wantedWays = new Set();
  for (const rel of relations) {
    for (const m of rel.members) if (m.type === 'way') wantedWays.add(m.ref);
  }

  log(`  · 解析 way（轨道/建筑/水系，候选 ${wantedWays.size} 条轨道 way）…`);
  const ways = new Map();
  const buildingWays = [];
  const riverWays = [];
  const lineWays = [];
  let totalWays = 0;
  await scan(pbfPath, 'ways', (items) => {
    for (const item of items) {
      if (item.type !== 'way' || !item.refs) continue;
      totalWays++;
      const tags = item.tags || {};
      const wanted = wantedWays.has(item.id);
      const isBuilding = !!tags.building && tags.building !== 'no';
      const isRiver = tags.waterway === 'river' && !!tags.name;
      const isLineWay =
        RAIL_TYPES.has(tags.railway) &&
        (tags.railway !== 'rail' || (tags.ref && ['1', '2', '4', '5', '6', '9', '10', '18', 'JT', 'BT'].includes(tags.ref)));
      if (!wanted && !isBuilding && !isRiver && !isLineWay) continue;
      const entry = { id: item.id, refs: item.refs, tags };
      ways.set(item.id, entry);
      if (isBuilding) buildingWays.push(entry);
      if (isRiver) riverWays.push(entry);
      if (isLineWay) lineWays.push(entry);
    }
  });

  const neededNodes = new Set();
  for (const rel of relations) {
    for (const m of rel.members) if (m.type === 'node') neededNodes.add(m.ref);
  }
  for (const way of ways.values()) for (const ref of way.refs) neededNodes.add(ref);

  log(`  · 解析 node（${neededNodes.size} 个所需节点）…`);
  const nodes = new Map();
  const stationNodes = [];
  await scan(pbfPath, 'nodes', (items) => {
    for (const item of items) {
      if (item.type !== 'node') continue;
      const tags = item.tags || {};
      const needed = neededNodes.has(item.id);
      const isStation =
        tags.railway === 'station' ||
        tags.station === 'subway' ||
        tags.railway === 'halt' ||
        tags.public_transport === 'station';
      if (!needed && !isStation) continue;
      const node = { id: item.id, lon: item.lon, lat: item.lat, tags: isStation || tags.name ? tags : null };
      nodes.set(item.id, node);
      if (isStation && tags.name) stationNodes.push(node);
    }
  });

  log(
    `  · 原始数据：${relations.length} 个轨道关系 / ${buildingWays.length} 栋建筑 / ${riverWays.length} 段河流 / ${totalWays} 条 way`,
  );

  const groups = new Map();
  for (const rel of relations) {
    const cls = classifyRelation(rel.tags);
    if (!cls) continue;
    const list = groups.get(cls.key) || [];
    list.push(rel);
    groups.set(cls.key, list);
  }

  const lines = [];
  const warnings = [];
  const stationPool = [];

  for (const [key, candidates] of groups) {
    const meta = LINE_META[key];
    if (!meta) continue;
    const chosen = pickRelation(key, candidates);
    if (!chosen) continue;

    const built = buildLinePath(chosen, ways, nodes, projection, bbox);
    if (!built || built.flat.length < 6) {
      warnings.push(`线路 ${meta.name} 缺少有效轨道几何，已跳过`);
      continue;
    }

    let stationEntries = collectStations(chosen, built, nodes, stationNodes, projection);
    if (stationEntries.length < 2) {
      warnings.push(`线路 ${meta.name} 车站不足 2 座，已跳过`);
      continue;
    }

    if (key !== 'loop' && stationEntries.length >= 4) {
      const stitched = stitchLine(
        key,
        stationEntries[0],
        stationEntries[stationEntries.length - 1],
        boundsOfPoints(built.flat),
        lineWays,
        nodes,
        projection,
      );
      if (stitched && stitched.points.length > 5) {
        const relationLength = pathLength(built.points);
        const stitchedLength = pathLength(stitched.points);
        const stitchedPts = stitched.points;
        let stitchedMaxGap = 0;
        for (let i = 1; i < stitchedPts.length; i++) {
          stitchedMaxGap = Math.max(
            stitchedMaxGap,
            Math.hypot(stitchedPts[i][0] - stitchedPts[i - 1][0], stitchedPts[i][1] - stitchedPts[i - 1][1]),
          );
        }
        if (process.env.OSM_DEBUG) {
          log(
            `    [debug] ${key} relation=${(relationLength / 1000).toFixed(1)}km stitched=${(stitchedLength / 1000).toFixed(1)}km maxGap=${(stitchedMaxGap / 1000).toFixed(2)}km pts=${stitchedPts.length}`,
          );
        }
        const firstDist = projectPointOnPolyline(
          ...projection.toLocal(stationEntries[0].lon, stationEntries[0].lat),
          stitchedPts,
        ).dist;
        const lastDist = projectPointOnPolyline(
          ...projection.toLocal(
            stationEntries[stationEntries.length - 1].lon,
            stationEntries[stationEntries.length - 1].lat,
          ),
          stitchedPts,
        ).dist;
        if (
          stitchedLength > relationLength * 0.65 &&
          stitchedLength < relationLength * 1.6 &&
          firstDist < 600 &&
          lastDist < 600
        ) {
          const rebuilt = stationEntries.map((s) => {
            const [x, z] = projection.toLocal(s.lon, s.lat);
            return { ...s, dist: projectPointOnPolyline(x, z, stitchedPts).along };
          });
          rebuilt.sort((a, b) => a.dist - b.dist);
          const prevGap = Math.abs(stitchedLength - relationLength);
          if (prevGap > 400) {
            warnings.push(
              `${meta.name} 轨道已按同线路 way 重新拼接（${(relationLength / 1000).toFixed(1)} → ${(stitchedLength / 1000).toFixed(1)} km）`,
            );
          }
          built.points = stitchedPts;
          built.flat = stitched.flat;
          built.bridgeRanges = stitched.bridgeRanges;
          built.tunnelRanges = stitched.tunnelRanges;
          stationEntries = rebuilt.filter((s, i, arr) => (i === 0 ? true : s.dist > arr[i - 1].dist + 20));
        }
      }
    }

    const simple = simplifyFlat(built.flat, key === 'loop' ? 3 : 4);
    const lineStations = stationEntries
      .map((s) => ({
        name: s.name,
        lon: s.lon,
        lat: s.lat,
        dist: s.dist,
      }))
      .filter((s, i, arr) => (i === 0 ? true : s.dist > arr[i - 1].dist + 20));

    if (key === 'loop' && lineStations.length > 3) {
      while (
        lineStations.length > 3 &&
        lineStations[lineStations.length - 1].name === lineStations[0].name
      ) {
        lineStations.pop();
      }
    }

    if (lineStations.length < 2) {
      warnings.push(`线路 ${meta.name} 车站序列无效，已跳过`);
      continue;
    }

    const stationRefs = mergeStationsIntoPool(lineStations, key, stationPool, projection);
    const lineLength = pathLength(toPoints(simple));
    const surface = buildSurfaceRanges(built, lineLength);
    const bounds = boundsOfPoints(simple);

    lines.push({
      id: key,
      ref: meta.ref,
      name: meta.name,
      color: meta.color,
      path: roundFlat(dedupeFlat(simple), 1),
      length: Math.round(lineLength),
      closedLoop: !!meta && key === 'loop',
      bounds: bounds.map((v) => Math.round(v)),
      stations: stationRefs.map((r) => ({ ...r })),
      surface,
      termini: [lineStations[0].name, lineStations[lineStations.length - 1].name],
      speedKph: city.lineSpeedKph?.[key] ?? 36,
    });

    log(
      `  · ${meta.name}: ${lineStations.length} 站 / ${(lineLength / 1000).toFixed(1)} km / ${simple.length / 2} 点`,
    );
  }

  const stations = finalizeStations(stationPool);
  for (const line of lines) {
    for (const st of line.stations) {
      const global = stations.find((g) => g.id === st.id);
      if (global && !global.lines.includes(line.id)) global.lines.push(line.id);
    }
  }

  const buildings = buildBuildings(buildingWays, nodes, projection, bbox);
  const rivers = buildRivers(riverWays, nodes, projection, bbox);

  return {
    projection,
    lines: lines.sort((a, b) => lineOrder(a.id) - lineOrder(b.id)),
    stations,
    buildings,
    rivers,
    warnings,
  };
}

function lineOrder(id) {
  const order = ['loop', '1', '2', '3', '3-airport', '4', '5', '6', '6-guobo', '9', '10', '18', 'jiangtiao', 'bitong'];
  const idx = order.indexOf(id);
  return idx === -1 ? 99 : idx;
}

function pickRelation(key, candidates) {
  const scored = candidates
    .map((rel) => {
      const stops = rel.members.filter((m) => m.type === 'node').length;
      const trackWays = rel.members.filter((m) => m.type === 'way').length;
      const isClockwise = (rel.tags.name || '').includes('顺时针');
      return { rel, score: stops + trackWays * 0.05, isClockwise };
    })
    .sort((a, b) => b.score - a.score);
  if (key === 'loop') {
    return scored.find((s) => s.isClockwise)?.rel || scored[0]?.rel || null;
  }
  return scored[0]?.rel || null;
}

function toPoints(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
}

function buildLinePath(rel, ways, nodes, projection, bbox) {
  const members = rel.members.filter((m) => {
    if (m.type !== 'way') return false;
    const way = ways.get(m.ref);
    if (!way) return false;
    const t = way.tags || {};
    if (t.railway && !RAIL_TYPES.has(t.railway)) return false;
    if (t.building) return false;
    return way.refs.length >= 2;
  });
  if (!members.length) return null;

  const flat = [];
  const bridgeRanges = [];
  const tunnelRanges = [];
  let acc = 0;
  let gaps = 0;

  const pushPoint = (x, z) => {
    if (flat.length >= 2) {
      const dx = x - flat[flat.length - 2];
      const dz = z - flat[flat.length - 1];
      if (Math.hypot(dx, dz) < 0.8) return false;
    }
    flat.push(x, z);
    return true;
  };

  for (const member of members) {
    const way = ways.get(member.ref);
    const tags = way.tags || {};
    const coords = way.refs
      .map((ref) => nodes.get(ref))
      .filter((n) => n && n.lon != null)
      .map((n) => projection.toLocal(n.lon, n.lat));
    if (coords.length < 2) continue;

    if (flat.length >= 2) {
      const ex = flat[flat.length - 2];
      const ez = flat[flat.length - 1];
      const dStart = Math.hypot(coords[0][0] - ex, coords[0][1] - ez);
      const dEnd = Math.hypot(coords[coords.length - 1][0] - ex, coords[coords.length - 1][1] - ez);
      if (dEnd < dStart) coords.reverse();
      if (Math.min(dStart, dEnd) > 400) gaps++;
    }

    const before = flat.length / 2;
    let segStartAcc = acc;
    for (const [x, z] of coords) {
      if (pushPoint(x, z)) {
        if (flat.length / 2 > 1) {
          const dx = flat[flat.length - 2] - flat[flat.length - 4];
          const dz = flat[flat.length - 1] - flat[flat.length - 3];
          acc += Math.hypot(dx, dz);
        }
      }
    }
    const segEndAcc = acc;
    if (flat.length / 2 - before > 1) {
      if (tags.bridge === 'yes' || tags['bridge:structure'] || tags.man_made === 'bridge') {
        bridgeRanges.push([segStartAcc, segEndAcc]);
      }
      if (tags.tunnel === 'yes') {
        tunnelRanges.push([segStartAcc, segEndAcc]);
      }
    }
  }

  const pts = toPoints(dedupeFlat(flat, 1));
  if (pts.length < 3) return null;

  const inBounds = pts.filter((p) => {
    const [lon, lat] = projection.toLonLat(p[0], p[1]);
    return lon >= bbox[0] - 0.05 && lon <= bbox[2] + 0.05 && lat >= bbox[1] - 0.05 && lat <= bbox[3] + 0.05;
  });
  if (inBounds.length < pts.length * 0.8) return null;

  return {
    flat,
    points: pts,
    bridgeRanges,
    tunnelRanges,
    gaps,
  };
}

function buildSurfaceRanges(built, lineLength) {
  const clamp = (ranges) =>
    ranges
      .map(([a, b]) => [Math.max(0, Math.round(a)), Math.min(lineLength, Math.round(b))])
      .filter(([a, b]) => b - a > 60);
  return {
    bridge: clamp(built.bridgeRanges),
    tunnel: clamp(built.tunnelRanges),
  };
}

function matchLineWay(tags, key) {
  const ref = String(tags.ref || '');
  const name = String(tags.name || '');
  if (!ref && !name) return true;
  if (key === 'loop') return ref === '环';
  if (key === '3-airport') return ref === '3' && name.includes('空港');
  if (key === '6-guobo') return ref === '6' && name.includes('国博');
  if (key === '3') return ref === '3' && !name.includes('空港');
  if (key === '6') return ref === '6' && !name.includes('国博');
  if (key === 'jiangtiao') return ref === 'JT' || name.includes('江跳');
  if (key === 'bitong') return ref === 'BT' || name.includes('璧铜');
  if (['1', '2', '4', '5', '9', '10', '18'].includes(key)) {
    return ref === key || (ref === '' && name.includes(`${key}号线`));
  }
  return false;
}

function stitchKey(p) {
  return `${Math.round(p[0] / 25)},${Math.round(p[1] / 25)}`;
}

/** Rebuild a line's track by walking all same-line OSM ways between the two terminus stations. */
function stitchLine(key, startStation, endStation, corridorBounds, lineWays, nodes, projection) {
  const [sx, sz] = projection.toLocal(startStation.lon, startStation.lat);
  const [ex, ez] = projection.toLocal(endStation.lon, endStation.lat);
  const margin = 2600;
  const edges = [];

  for (const way of lineWays) {
    if (!matchLineWay(way.tags, key)) continue;
    const pts = way.refs
      .map((ref) => nodes.get(ref))
      .filter((n) => n && n.lon != null)
      .map((n) => projection.toLocal(n.lon, n.lat));
    if (pts.length < 2) continue;
    const inside = pts.some(
      (p) =>
        p[0] > corridorBounds[0] - margin &&
        p[0] < corridorBounds[2] + margin &&
        p[1] > corridorBounds[1] - margin &&
        p[1] < corridorBounds[3] + margin,
    );
    if (!inside) continue;
    const length = pathLength(pts);
    if (length < 30) continue;
    const aKey = stitchKey(pts[0]);
    const bKey = stitchKey(pts[pts.length - 1]);
    if (aKey === bKey) continue;
    edges.push({ pts, tags: way.tags, aKey, bKey, length });
  }

  if (edges.length < 4) return null;

  const adj = new Map();
  const add = (from, to, cost, entry) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, cost, entry });
  };
  for (const e of edges) {
    const fwd = e.pts;
    const rev = [...e.pts].reverse();
    add(e.aKey, e.bKey, e.length, { pts: fwd, tags: e.tags });
    add(e.bKey, e.aKey, e.length, { pts: rev, tags: e.tags });
  }

  const keys = [...adj.keys()];
  const nearest = (x, z) => {
    let best = null;
    let bestD = Infinity;
    for (const k of keys) {
      const [kx, kz] = k.split(',').map(Number);
      const cx = kx * 25;
      const cz = kz * 25;
      const d = Math.hypot(cx - x, cz - z);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return { key: best, dist: bestD };
  };

  const start = nearest(sx, sz);
  const end = nearest(ex, ez);
  if (!start.key || !end.key || start.dist > 900 || end.dist > 900) return null;

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  for (const k of keys) dist.set(k, Infinity);
  dist.set(start.key, 0);

  for (let iter = 0; iter < keys.length; iter++) {
    let current = null;
    let bestD = Infinity;
    for (const k of keys) {
      if (visited.has(k)) continue;
      const d = dist.get(k);
      if (d < bestD) {
        bestD = d;
        current = k;
      }
    }
    if (!current || bestD === Infinity) break;
    if (current === end.key) break;
    visited.add(current);
    for (const edge of adj.get(current) || []) {
      const nd = bestD + edge.cost;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { from: current, pts: edge.entry.pts, tags: edge.entry.tags });
      }
    }
  }

  if (!prev.has(end.key)) return null;

  const ordered = [];
  let cursor = end.key;
  while (cursor !== start.key) {
    const item = prev.get(cursor);
    if (!item) return null;
    ordered.push(item);
    cursor = item.from;
  }
  ordered.reverse();

  const flat = [];
  const points = [];
  const bridgeRanges = [];
  const tunnelRanges = [];
  let acc = 0;
  let lastX = null;
  let lastZ = null;

  const pushPoint = (x, z) => {
    if (lastX != null) {
      const d = Math.hypot(x - lastX, z - lastZ);
      if (d < 1) return;
      acc += d;
    }
    flat.push(x, z);
    points.push([x, z]);
    lastX = x;
    lastZ = z;
  };

  for (const item of ordered) {
    const segStart = acc;
    for (const [x, z] of item.pts) pushPoint(x, z);
    const segEnd = acc;
    if (item.tags?.bridge === 'yes' || item.tags?.['bridge:structure'] || item.tags?.man_made === 'bridge') {
      bridgeRanges.push([segStart, segEnd]);
    }
    if (item.tags?.tunnel === 'yes') tunnelRanges.push([segStart, segEnd]);
  }

  if (points.length < 6) return null;
  return { flat, points, bridgeRanges, tunnelRanges };
}

function collectStations(rel, built, nodes, stationNodes, projection) {
  const pts = built.points;
  const candidates = [];

  for (const member of rel.members) {
    if (member.type !== 'node') continue;
    const node = nodes.get(member.ref);
    if (!node) continue;
    const name = node.tags?.name || node.tags?.['name:zh'];
    if (!name) continue;
    const [x, z] = projection.toLocal(node.lon, node.lat);
    candidates.push({
      name,
      lon: node.lon,
      lat: node.lat,
      dist: projectPointOnPolyline(x, z, pts).along,
      source: 'member',
    });
  }

  const pathBounds = boundsOfPoints(built.flat);
  for (const node of stationNodes) {
    const [x, z] = projection.toLocal(node.lon, node.lat);
    if (x < pathBounds[0] - 3000 || x > pathBounds[2] + 3000 || z < pathBounds[1] - 3000 || z > pathBounds[3] + 3000) {
      continue;
    }
    const proj = projectPointOnPolyline(x, z, pts);
    if (proj.dist > 260) continue;
    candidates.push({
      name: node.tags.name,
      lon: node.lon,
      lat: node.lat,
      dist: proj.along,
      source: 'nearby',
    });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  const merged = [];
  for (const cand of candidates) {
    const prev = merged[merged.length - 1];
    if (prev && prev.name === cand.name && Math.abs(prev.dist - cand.dist) < 400) continue;
    if (prev && cand.dist < prev.dist + 80) {
      if (prev.source === 'nearby' && cand.source === 'member') {
        merged[merged.length - 1] = cand;
      }
      continue;
    }
    merged.push(cand);
  }
  return merged;
}

function mergeStationsIntoPool(lineStations, lineId, pool, projection) {
  return lineStations.map((st) => {
    const [x, z] = projection.toLocal(st.lon, st.lat);
    let hit = pool.find((p) => p.name === st.name && Math.hypot(p.x - x, p.z - z) < 500);
    if (!hit) {
      hit = {
        id: `st-${pool.length + 1}`,
        name: st.name,
        lon: st.lon,
        lat: st.lat,
        x,
        z,
        lines: [lineId],
      };
      pool.push(hit);
    } else if (!hit.lines.includes(lineId)) {
      hit.lines.push(lineId);
    }
    return { id: hit.id, name: hit.name, dist: Math.round(st.dist) };
  });
}

function finalizeStations(pool) {
  return pool.map((s) => ({
    id: s.id,
    name: s.name,
    lon: Number(s.lon.toFixed(6)),
    lat: Number(s.lat.toFixed(6)),
    x: s.x,
    z: s.z,
    lines: s.lines,
  }));
}

function buildBuildings(buildingWays, nodes, projection, cityBbox) {
  const out = [];
  for (const way of buildingWays) {
    const coords = way.refs
      .map((ref) => nodes.get(ref))
      .filter((n) => n && n.lon != null)
      .map((n) => projection.toLocal(n.lon, n.lat));
    if (coords.length < 4) continue;
    const closed = Math.hypot(coords[0][0] - coords[coords.length - 1][0], coords[0][1] - coords[coords.length - 1][1]) < 2;
    const ring = closed ? coords.slice(0, -1) : coords;
    if (ring.length < 3) continue;

    let lonMin = 180;
    let lonMax = -180;
    let latMin = 90;
    let latMax = -90;
    for (const [x, z] of ring) {
      const [lon, lat] = projection.toLonLat(x, z);
      lonMin = Math.min(lonMin, lon);
      lonMax = Math.max(lonMax, lon);
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
    }
    if (
      lonMin < cityBbox[0] ||
      lonMax > cityBbox[2] ||
      latMin < cityBbox[1] ||
      latMax > cityBbox[3]
    ) {
      continue;
    }

    let angle = 0;
    let longest = 0;
    for (let i = 1; i < ring.length; i++) {
      const d = Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
      if (d > longest) {
        longest = d;
        angle = Math.atan2(ring[i][1] - ring[i - 1][1], ring[i][0] - ring[i - 1][0]);
      }
    }
    const ca = Math.cos(-angle);
    const sa = Math.sin(-angle);
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;
    for (const [x, z] of ring) {
      const dx = x - cx;
      const dz = z - cz;
      const u = dx * ca - dz * sa;
      const v = dx * sa + dz * ca;
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
    const halfW = (uMax - uMin) / 2;
    const halfD = (vMax - vMin) / 2;
    if (halfW < 2 || halfD < 2) continue;
    if (halfW * halfD * 4 < 24) continue;
    if (halfW > 400 || halfD > 400) continue;

    const height = Math.max(4, Math.min(240, parseHeight(way.tags)));
    out.push([cx, cz, halfW, halfD, height, angle]);
  }
  return out;
}

function buildRivers(riverWays, nodes, projection, cityBbox) {
  const rivers = [];
  for (const way of riverWays) {
    const coords = way.refs
      .map((ref) => nodes.get(ref))
      .filter((n) => n && n.lon != null)
      .map((n) => projection.toLocal(n.lon, n.lat));
    if (coords.length < 2) continue;
    const [lon, lat] = projection.toLonLat(coords[0][0], coords[0][1]);
    if (lon < cityBbox[0] || lon > cityBbox[2] || lat < cityBbox[1] || lat > cityBbox[3]) continue;
    const flat = simplifyFlat(roundFlat(coords.flat(), 1), 60);
    if (pathLength(toPoints(flat)) < 700) continue;
    const name = String(way.tags.name).replace(/[（）()]/g, '').trim();
    const width = Number(way.tags.width) || RIVER_WIDTH[name] || 90;
    rivers.push({ name, width: Math.min(900, Math.max(40, width)), path: flat });
  }
  return rivers;
}


