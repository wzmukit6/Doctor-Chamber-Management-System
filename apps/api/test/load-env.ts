import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Forces the test environment. Values override anything already loaded
 * (Prisma auto-loads apps/api/.env on import, which points at the dev DB).
 * When global setup created a throwaway database for this run, use it.
 */
export function applyTestEnv() {
  const parsed = parseEnv(readFileSync(resolve(__dirname, '../.env.test'), 'utf8'));
  Object.assign(process.env, parsed);
  if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
}

applyTestEnv();
