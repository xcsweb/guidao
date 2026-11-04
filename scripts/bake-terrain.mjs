import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeTerrain } from './lib/terrain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cityId = (args.find((a) => a.startsWith('--city=')) || '--city=cq').split('=')[1];
const city = JSON.parse(readFileSync(join(ROOT, 'scripts/cities', `${cityId}.json`), 'utf8'));

console.log(`\n=== 烘焙地形：${city.name} (${city.id}) ===`);
await bakeTerrain(city, join(ROOT, 'public/data', city.id), join(ROOT, '.cache'), console.log);
console.log('\n完成。');
