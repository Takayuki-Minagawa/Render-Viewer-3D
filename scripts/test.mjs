import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort();
const result = spawnSync(process.execPath, ['--test', ...files.map(name => `tests/${name}`)], { stdio: 'inherit', timeout: 60_000, killSignal: 'SIGTERM', env: { ...process.env, RV3D_UNIT_TEST: '1' } });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
