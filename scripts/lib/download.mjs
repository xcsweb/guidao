import { spawn } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'cq-transit-3d/1.0 (offline data build)';

export function download(url, dest, { resume = true, retries = 3 } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const args = [
      '-sS',
      '-L',
      '--retry',
      String(retries),
      '--retry-delay',
      '2',
      '--retry-all-errors',
      '-A',
      UA,
      '-o',
      dest,
    ];
    if (resume) args.push('-C', '-');
    args.push(url);
    const child = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`curl failed (${code}): ${err.trim().slice(0, 300)}`));
      else resolve(dest);
    });
  });
}

export async function ensureDownloaded(url, dest, { minBytes = 1024 } = {}) {
  if (existsSync(dest) && statSync(dest).size >= minBytes) return dest;
  await download(url, dest);
  if (!existsSync(dest) || statSync(dest).size < minBytes) {
    throw new Error(`download too small: ${dest}`);
  }
  return dest;
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
