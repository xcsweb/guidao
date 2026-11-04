export const EARTH_M_PER_DEG_LAT = 111132.92;
export const EARTH_M_PER_DEG_LON_EQ = 111319.49;

export function makeProjection(centerLon, centerLat) {
  const mPerDegLon = EARTH_M_PER_DEG_LON_EQ * Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = EARTH_M_PER_DEG_LAT;
  return {
    lon0: centerLon,
    lat0: centerLat,
    mPerDegLon,
    mPerDegLat,
    toLocal(lon, lat) {
      return [(lon - centerLon) * mPerDegLon, (centerLat - lat) * mPerDegLat];
    },
    toLonLat(x, z) {
      return [centerLon + x / mPerDegLon, centerLat - z / mPerDegLat];
    },
  };
}

export function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

export function cumulativeLengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

/** Douglas-Peucker on flat [x,z,...] arrays */
export function simplifyFlat(flat, epsilon) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  if (pts.length <= 2) return flat.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const ax = pts[s][0];
    const ay = pts[s][1];
    const bx = pts[e][0];
    const by = pts[e][1];
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      const d =
        Math.hypot(dx, dy) < 1e-6
          ? Math.hypot(px, py)
          : Math.abs(px * dy - py * dx) / segLen;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i][0], pts[i][1]);
  }
  return out;
}

export function projectPointOnPolyline(px, pz, points) {
  let best = { dist: Infinity, along: 0, x: 0, z: 0 };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1][0];
    const az = points[i - 1][1];
    const bx = points[i][0];
    const bz = points[i][1];
    const dx = bx - ax;
    const dz = bz - az;
    const segLen2 = dx * dx + dz * dz;
    let t = segLen2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / segLen2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < best.dist) {
      best = { dist: d, along: acc + Math.sqrt(segLen2) * t, x: cx, z: cz };
    }
    acc += Math.sqrt(segLen2);
  }
  return best;
}

export function boundsOfPoints(flat) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]);
    maxX = Math.max(maxX, flat[i]);
    minZ = Math.min(minZ, flat[i + 1]);
    maxZ = Math.max(maxZ, flat[i + 1]);
  }
  return [minX, minZ, maxX, maxZ];
}

export function dedupeFlat(flat, minDistance = 0.5) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i];
    const z = flat[i + 1];
    if (out.length >= 2) {
      const dx = x - out[out.length - 2];
      const dz = z - out[out.length - 1];
      if (Math.hypot(dx, dz) < minDistance) continue;
    }
    out.push(x, z);
  }
  return out;
}

export function roundFlat(flat, digits = 1) {
  const p = 10 ** digits;
  return flat.map((v) => Math.round(v * p) / p);
}
