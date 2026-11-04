import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { download, mapLimit } from './download.mjs';
import { makeProjection } from './geo.mjs';

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function tileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
function tileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export async function bakeTerrain(city, outDir, cacheDir, log = console.log) {
  mkdirSync(outDir, { recursive: true });
  const projection = makeProjection(city.center[0], city.center[1]);
  const tiers = [];

  for (const tier of city.terrain.tiers) {
    const z = tier.z;
    const [lonMin, latMin, lonMax, latMax] = tier.bbox;
    const x0 = Math.floor(tileX(lonMin, z));
    const x1 = Math.floor(tileX(lonMax, z));
    const y0 = Math.floor(tileY(latMax, z));
    const y1 = Math.floor(tileY(latMin, z));
    const nx = x1 - x0 + 1;
    const ny = y1 - y0 + 1;
    const tiles = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push([x, y]);

    log(`  · 地形层 ${tier.id}：z${z} ${nx}×${ny} = ${tiles.length} 瓦片`);
    let done = 0;
    const heights = new Map();
    await mapLimit(tiles, 8, async ([x, y]) => {
      const path = join(cacheDir, 'terrain', String(z), String(x), `${y}.png`);
      const fresh = existsSync(path) && statSync(path).size > 4096;
      if (!fresh) await download(TILE_URL(z, x, y), path);
      heights.set(`${x},${y}`, decodeTile(path));
      done++;
      if (done % 30 === 0 || done === tiles.length) log(`    下载/解码 ${done}/${tiles.length}`);
    });

    const nativeW = nx * 256;
    const nativeH = ny * 256;
    const native = new Float32Array(nativeW * nativeH);
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        const tile = heights.get(`${x0 + tx},${y0 + ty}`);
        for (let row = 0; row < 256; row++) {
          const src = row * 256;
          const dst = (ty * 256 + row) * nativeW + tx * 256;
          native.set(tile.subarray(src, src + 256), dst);
        }
      }
    }

    const leftLon = (x0 / 2 ** z) * 360 - 180;
    const topLat = latFromTileRow(y0, z);
    const bottomLat = latFromTileRow(y1 + 1, z);
    const lonSpan = (x1 + 1 - x0) * (360 / 2 ** z);
    const latSpan = topLat - bottomLat;

    const widthMeters = (lonMax - lonMin) * projection.mPerDegLon;
    const heightMeters = (latMax - latMin) * projection.mPerDegLat;
    const width = Math.round(tier.targetWidth);
    const height = Math.max(4, Math.round(width * (heightMeters / widthMeters)));

    const out = new Int16Array(width * height);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let row = 0; row < height; row++) {
      const lat = latMax - ((row + 0.5) / height) * (latMax - latMin);
      const py = ((topLat - lat) / latSpan) * nativeH - 0.5;
      for (let col = 0; col < width; col++) {
        const lon = lonMin + ((col + 0.5) / width) * (lonMax - lonMin);
        const px = ((lon - leftLon) / lonSpan) * nativeW - 0.5;
        const h = sampleBilinear(native, nativeW, nativeH, px, py);
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
        const q = Math.max(-32000, Math.min(32000, Math.round(h / 0.5)));
        out[row * width + col] = q;
      }
    }

    const file = `terrain-${tier.id}.bin`;
    writeFileSync(join(outDir, file), Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    tiers.push({
      id: tier.id,
      file,
      bbox: tier.bbox,
      width,
      height,
      minH: Number(minH.toFixed(1)),
      maxH: Number(maxH.toFixed(1)),
      resolutionX: Number((widthMeters / width).toFixed(2)),
      resolutionZ: Number((heightMeters / height).toFixed(2)),
    });
    log(
      `    输出 ${file}: ${width}×${height}，高程 ${minH.toFixed(1)}–${maxH.toFixed(1)} m，` +
        `${(out.byteLength / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  const meta = {
    quantization: 0.5,
    tiers,
  };
  writeFileSync(join(outDir, 'terrain.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function latFromTileRow(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function decodeTile(path) {
  const png = PNG.sync.read(readFileSync(path));
  const data = png.data;
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

function sampleBilinear(arr, w, h, px, py) {
  const x = Math.max(0, Math.min(w - 1, px));
  const y = Math.max(0, Math.min(h - 1, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = arr[y0 * w + x0];
  const b = arr[y0 * w + x1];
  const c = arr[y1 * w + x0];
  const d = arr[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
