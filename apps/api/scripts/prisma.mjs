import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { databaseUrl } from './config.mjs';

const require = createRequire(import.meta.url);
process.env.DATABASE_URL ||= databaseUrl();
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...process.argv.slice(2)], {stdio: 'inherit', env: process.env});
process.exit(result.status ?? 1);
