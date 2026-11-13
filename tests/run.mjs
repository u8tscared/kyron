// Lance toutes les suites de tests : node tests/run.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  console.log(`${r.status === 0 ? 'OK ' : 'ÉCHEC'} ${f}`);
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
