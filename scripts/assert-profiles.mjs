import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson(join(ROOT, 'public/data/cq/manifest.json'));
const dataDir = join(ROOT, 'public/data', manifest.id);
const network = readJson(join(dataDir, manifest.assets.network));
const terrainMeta = readJson(join(dataDir, manifest.assets.terrain));
const terrainBuffers = terrainMeta.tiers.map((tier) => {
  const buffer = readFileSync(join(dataDir, tier.file));
  return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
});
const lineDataBefore = network.lines.map((line) => ({
  path: [...line.path],
  length: line.length,
  stations: line.stations.map((station) => [station.id, station.dist]),
  bridge: line.surface.bridge.map((range) => [...range]),
  tunnel: line.surface.tunnel.map((range) => [...range]),
}));

const previousDocument = globalThis.document;
globalThis.document = {
  createElement: () => ({
    style: {},
    dataset: {},
    setAttribute() {},
  }),
};

const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
let terrain;
let transit;
let stationDetail;
let corridor;
let portals;

try {
  const { TerrainSystem } = await server.ssrLoadModule('/src/engine/Terrain.ts');
  const { GROUND_TRACK_OFFSET } = await server.ssrLoadModule('/src/engine/LineGeometry.ts');
  const { TransitLayer } = await server.ssrLoadModule('/src/engine/TransitLayer.ts');
  const { StationDetailLayer } = await server.ssrLoadModule('/src/engine/StationDetailLayer.ts');
  const { RailCorridor, TRACK_SLOT_OFFSET, PORTAL_HOLE_HALF_WIDTH } = await server.ssrLoadModule('/src/engine/RailCorridor.ts');
  const { TunnelPortalLayer } = await server.ssrLoadModule('/src/engine/TunnelPortalLayer.ts');

  terrain = new TerrainSystem(manifest, terrainMeta, terrainBuffers);
  transit = new TransitLayer(network, terrain);
  corridor = new RailCorridor(transit.geometries);
  terrain.setCorridor(corridor);
  portals = new TunnelPortalLayer(corridor, transit.geometries);
  stationDetail = new StationDetailLayer(
    network,
    transit.geometries,
    transit.stationPositions,
    900,
    55,
  );

  let groundSamples = 0;
  let tunnelRanges = 0;
  let bridgeRanges = 0;
  let longestCheckedTunnel = 0;
  let cuttingSamples = 0;
  let deepCoveredSamples = 0;
  let portalChecks = 0;

  for (const [lineIndex, line] of network.lines.entries()) {
    const geo = transit.geometries.get(line.id);
    assert.ok(geo, `${line.id}: 缺少线路几何`);
    assert.equal(geo.groundYs.length, geo.ys.length, `${line.id}: 自然地形采样未对齐`);
    assert.equal(geo.cum.length, geo.ys.length, `${line.id}: 里程采样未对齐`);

    const lineCorridor = new RailCorridor(new Map([[line.id, geo]]));
    const before = lineDataBefore[lineIndex];
    assert.deepEqual([...line.path], before.path, `${line.id}: 水平路径被改写`);
    assert.equal(line.length, before.length, `${line.id}: 线路里程被改写`);
    assert.deepEqual(
      line.stations.map((station) => [station.id, station.dist]),
      before.stations,
      `${line.id}: 站点 dist 被改写`,
    );
    assert.deepEqual(line.surface.bridge, before.bridge, `${line.id}: 桥梁区间被改写`);
    assert.deepEqual(line.surface.tunnel, before.tunnel, `${line.id}: 隧道区间被改写`);

    for (const stationRef of line.stations) {
      const point = geo.stations.find((station) => station.id === stationRef.id);
      assert.ok(point, `${line.id}/${stationRef.id}: 缺少线路站点锚点`);
      const expectedS = Math.max(
        0,
        Math.min(geo.length, (stationRef.dist / (line.length || 1)) * geo.length),
      );
      close(point.s, expectedS, 1e-6, `${line.id}/${stationRef.id}: 站点里程发生变化`);
      const stationIndex = sampleIndex(geo, point.s);
      close(point.y, geo.ys[stationIndex], 1e-6, `${line.id}/${stationRef.id}: 站台未使用轨道面`);
      close(point.groundY, geo.groundYs[stationIndex], 1e-6, `${line.id}/${stationRef.id}: 自然地面锚点未对齐`);
    }

    for (let i = 0; i < geo.ys.length; i++) {
      const s = geo.cum[i];
      assert.ok(Number.isFinite(geo.ys[i]), `${line.id}@${s}: 非有限轨道高程`);
      close(
        geo.groundYs[i],
        terrain.heightAt(geo.xs[i], geo.zs[i]),
        0.03,
        `${line.id}@${s}: 不是自然地形中心采样`,
      );
      const inTunnel = insideAny(s, geo.tunnels);
      const inBridge = insideAny(s, geo.bridges);
      if (!inTunnel && !inBridge) {
        close(
          geo.ys[i] - geo.groundYs[i],
          GROUND_TRACK_OFFSET,
          0.03,
          `${line.id}@${s}: 普通地面段未贴合中心地形`,
        );
        groundSamples++;
        if (i % 97 === 0) {
          const syntheticHighGround = geo.ys[i] + 12;
          const cut = corridor.modifiedHeightAt(geo.xs[i], geo.zs[i], syntheticHighGround);
          assert.ok(
            cut <= geo.ys[i] - TRACK_SLOT_OFFSET + 0.03,
            `${line.id}@${s}: 高地走廊未形成槽底 (${cut.toFixed(2)}m)`,
          );
          cuttingSamples++;
        }
      }
      if (i > 0) {
        const ds = s - geo.cum[i - 1];
        const dy = Math.abs(geo.ys[i] - geo.ys[i - 1]);
        assert.ok(ds >= 0, `${line.id}@${s}: 里程倒退`);
        assert.ok(
          dy <= Math.max(40, ds * 3),
          `${line.id}@${s}: 相邻高程异常跳变 ${dy.toFixed(2)}m / ${ds.toFixed(2)}m`,
        );
      }
    }

    for (const [a, b] of geo.tunnels) {
      assert.ok(b >= a, `${line.id}: 隧道区间负长度`);
      const mid = (a + b) * 0.5;
      const sample = trackAt(geo, mid);
      const depth = sampleArray(geo, geo.groundYs, mid) - sample.y;
      assert.ok(depth > 0.05, `${line.id}@${mid}: 隧道中点未低于自然地形 (${depth.toFixed(2)}m)`);
      if (b - a >= 500) {
        const demDepth = terrain.heightAt(sample.x, sample.z) - sample.y;
        assert.ok(demDepth > 5, `${line.id}@${mid}: 长隧道实际埋深不足 (${demDepth.toFixed(2)}m)`);
        close(
          lineCorridor.modifiedHeightAt(sample.x, sample.z, demDepth + sample.y),
          demDepth + sample.y,
          1e-6,
          `${line.id}@${mid}: 深埋隧道中部被本线洞口错误开挖`,
        );
        deepCoveredSamples++;
        longestCheckedTunnel = Math.max(longestCheckedTunnel, b - a);
      }
      assertPortalContinuous(geo, a, b, line.id);
      const rangePortals = corridor.portals.filter((portal) => (
        portal.lineId === line.id && portal.range[0] === a && portal.range[1] === b
      ));
      assert.equal(rangePortals.length, 2, `${line.id}@${a}-${b}: 隧道两端门户数量不完整`);
      for (const portal of rangePortals) {
        assert.ok(portal.s >= a && portal.s <= b, `${portal.id}: 门户不在隧道区间内`);
        close(portal.y, sampleArray(geo, geo.ys, portal.s), 1e-4, `${portal.id}: 门户未对齐轨道面`);
        close(portal.groundY, sampleArray(geo, geo.groundYs, portal.s), 1e-4, `${portal.id}: 门户自然地面基准不一致`);
        const minimumCover = b - a >= 500 ? 4 : 0.05;
        assert.ok(portal.burial > minimumCover, `${portal.id}: 门户没有形成有效覆盖 (${portal.burial.toFixed(2)}m @ ${portal.s.toFixed(2)})`);
        assert.ok(portal.interiorDepth >= 2 && portal.interiorDepth <= 30, `${portal.id}: 短洞深度异常`);
        assert.ok(corridor.isPortalOpening(portal.x, portal.z), `${portal.id}: 缺少局部地形开口`);
        const lateral = PORTAL_HOLE_HALF_WIDTH + 5;
        assert.equal(
          corridor.isPortalOpening(portal.x - portal.tz * lateral, portal.z + portal.tx * lateral),
          false,
          `${portal.id}: 地形开口越出门架宽度`,
        );
        const expectedCut = Math.min(portal.groundY, portal.y - TRACK_SLOT_OFFSET);
        const actualCut = corridor.modifiedHeightAt(portal.x, portal.z, portal.groundY);
        assert.ok(
          actualCut <= expectedCut + 0.03 && actualCut >= portal.y - 25,
          `${portal.id}: 引道槽底未连接门户 (${actualCut.toFixed(2)} vs ${expectedCut.toFixed(2)})`,
        );
        const natural = terrain.heightAt(portal.x, portal.z);
        assert.ok(
          terrain.renderHeightAt(portal.x, portal.z) <= natural + 1e-6,
          `${portal.id}: 地形改造错误抬高了自然地面`,
        );
        const innerS = portal.s + portal.inward * portal.interiorDepth;
        assert.ok(innerS >= a && innerS <= b, `${portal.id}: 短洞未朝隧道内部延伸`);
        portalChecks++;
      }
      tunnelRanges++;
    }

    for (const [a, b] of geo.bridges) {
      assert.ok(b >= a, `${line.id}: 桥梁区间负长度`);
      const mid = (a + b) * 0.5;
      const deckY = sampleArray(geo, geo.ys, mid);
      const endpointGround = Math.max(
        sampleArray(geo, geo.groundYs, a),
        sampleArray(geo, geo.groundYs, b),
      );
      assert.ok(
        deckY >= endpointGround + 4,
        `${line.id}@${mid}: 桥面剖面未保持抬升 (${(deckY - endpointGround).toFixed(2)}m)`,
      );
      assertPortalContinuous(geo, a, b, line.id);
      bridgeRanges++;
    }
  }

  const undergroundStations = network.stations.filter((station) => station.stationType === 'underground');
  const mixedStations = network.stations.filter((station) => station.stationType === 'mixed');
  assert.ok(undergroundStations.length > 0, '没有可验证的地下站');
  assert.ok(mixedStations.length > 0, '没有可验证的混合站');

  for (const station of network.stations) {
    const anchor = transit.stationPositions.get(station.id);
    assert.ok(anchor, `${station.id}: 缺少车站位置`);
    close(anchor.groundY, terrain.heightAt(anchor.x, anchor.z), 0.03, `${station.id}: 街面锚点脱离自然地形`);
    const geo = transit.geometries.get(anchor.lineId);
    const point = geo?.stations.find((item) => item.id === station.id);
    assert.ok(geo && point, `${station.id}: 车站关联线路无效`);
    close(anchor.trackY, point.y, 0.03, `${station.id}: trackY 与所选线路不一致`);
    const model = stationDetail.models.find((item) => item.id === station.id);
    assert.ok(model, `${station.id}: 缺少近景模型锚点`);

    if (station.stationType === 'underground') {
      close(anchor.y, anchor.groundY, 1e-6, `${station.id}: 地下站地图锚点未回到街面`);
      close(model.y, anchor.groundY, 1e-6, `${station.id}: 地下出入口/通风模型未回到街面`);
      const label = transit.labels.find((item) => item.stationId === station.id);
      assert.ok(label, `${station.id}: 缺少 CSS2D 标签`);
      close(label.object.position.y - anchor.groundY, 32, 1e-6, `${station.id}: 地下站标签未使用街面锚点`);
    } else {
      close(anchor.y, anchor.trackY, 1e-6, `${station.id}: 地上站地图锚点未使用轨道面`);
      close(model.y, anchor.trackY, 1e-6, `${station.id}: 地上站模型未使用轨道面`);
    }

    if (station.stationType === 'mixed') {
      assert.equal(geo.isInsideTunnel(point.s), false, `${station.id}: 混合站地上设施仍关联地下线路`);
      assert.equal(model.underground, false, `${station.id}: 混合站被错误建模为纯地下站`);
    }
  }

  assert.ok(corridor.portals.length > 0, '没有可验证的隧道门户');
  const testPortal = corridor.portals[0];
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(testPortal.x, testPortal.y + 20, testPortal.z);
  portals.update(camera);
  assert.ok(portals.activeCount > 0, '近景门户未按需生成');
  assert.equal(portals.group.children.length, portals.activeCount, '门户场景节点数量不一致');
  const firstRoot = portals.group.children[0];
  const firstFrame = firstRoot.children.find((child) => child.name === 'lining-and-headwall');
  const firstBore = firstRoot.children.find((child) => child.name === 'short-bore');
  assert.ok(firstFrame && firstBore, '门户缺少门架或短洞几何');
  let boreDisposed = false;
  firstBore.geometry.addEventListener('dispose', () => { boreDisposed = true; });
  portals.update(camera);
  assert.equal(portals.group.children[0], firstRoot, '相机静止时门户被重复重建');
  const sharedFrameGeometry = firstFrame.geometry;
  portals.setQuality('high');
  assert.ok(boreDisposed, '画质切换未释放旧门户短洞几何');
  assert.equal(portals.activeCount, 0, '画质切换未清空旧门户缓存');
  portals.update(camera);
  const rebuiltFrame = portals.group.children[0].children.find((child) => child.name === 'lining-and-headwall');
  assert.equal(rebuiltFrame.geometry, sharedFrameGeometry, '画质切换未复用共享门架几何');

  const fx = testPortal.tx * testPortal.inward;
  const fz = testPortal.tz * testPortal.inward;
  camera.position.set(testPortal.x - fx * 90, testPortal.y + 32, testPortal.z - fz * 90);
  camera.lookAt(testPortal.x, testPortal.y + 2, testPortal.z);
  terrain.setViewport(900, 55);
  terrain.update(camera, 1);
  assert.ok(terrain.visibleChunks > 0, '近景地形块未生成');
  const firstVisibleChunk = terrain.group.children.find((child) => child.visible);
  const cachedChunkCount = terrain.group.children.length;
  let carvedVertices = 0;
  for (const mesh of terrain.group.children) {
    if (!mesh.visible) continue;
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      if (terrain.heightAt(x, z) - positions.getY(i) > 0.5) {
        carvedVertices++;
        break;
      }
    }
    if (carvedVertices > 0) break;
  }
  assert.ok(carvedVertices > 0, '近景地形块没有实际路堑/引道开挖顶点');
  terrain.update(camera, 2);
  assert.equal(terrain.group.children.length, cachedChunkCount, '相机静止时地形块被重复创建');
  assert.equal(terrain.group.children.find((child) => child.visible), firstVisibleChunk, '相机静止时地形块缓存失效');
  terrain.setQuality('high');
  assert.equal(terrain.group.children.length, 0, '画质切换未清理旧地形块');
  terrain.update(camera, 3);
  assert.ok(terrain.visibleChunks > 0, '高画质地形块未能重建');

  camera.position.set(1000000, 100, 1000000);
  portals.update(camera);
  assert.equal(portals.activeCount, 0, '远离后门户缓存未失效');

  console.log(
    `剖面断言通过：${network.lines.length} 条线，${groundSamples} 个地面采样，`
    + `${tunnelRanges} 个隧道区间，${bridgeRanges} 个桥梁区间，`
    + `${undergroundStations.length} 个纯地下站，${mixedStations.length} 个混合站。`,
  );
  console.log(`路堑/门户断言通过：${cuttingSamples} 个合成高地槽底，${deepCoveredSamples} 个深埋覆盖采样，${portalChecks} 个门户；懒加载、复用与释放正常。`);
  console.log(`已验证最长隧道区间：${(longestCheckedTunnel / 1000).toFixed(2)} km；路径、里程和站点 dist 保持不变。`);
} finally {
  portals?.dispose();
  stationDetail?.dispose();
  transit?.dispose();
  terrain?.dispose();
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  await server.close();
}

function close(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} (${actual} vs ${expected})`,
  );
}

function insideAny(s, ranges) {
  return ranges.some(([a, b]) => s >= a && s <= b);
}

function sampleIndex(geo, s) {
  let lo = 0;
  let hi = geo.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (geo.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

function sampleArray(geo, values, s) {
  const index = Math.min(geo.cum.length - 2, sampleIndex(geo, s));
  const span = geo.cum[index + 1] - geo.cum[index] || 1;
  const t = Math.max(0, Math.min(1, (s - geo.cum[index]) / span));
  return values[index] * (1 - t) + values[index + 1] * t;
}

function trackAt(geo, s) {
  const sample = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  geo.sampleAt(s, sample);
  return sample;
}

function assertPortalContinuous(geo, a, b, lineId) {
  const epsilon = Math.min(0.5, Math.max(0.01, (b - a) / 8));
  for (const portal of [a, b]) {
    if (portal <= epsilon || portal >= geo.length - epsilon) continue;
    const before = trackAt(geo, portal - epsilon);
    const after = trackAt(geo, portal + epsilon);
    assert.ok(
      Math.abs(after.y - before.y) <= 2,
      `${lineId}@${portal}: 洞口高程不连续 (${Math.abs(after.y - before.y).toFixed(2)}m)`,
    );
  }
}
