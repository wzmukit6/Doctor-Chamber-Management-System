import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';

/** Drops the throwaway database created by global-setup for this run (and only that one). */
export default async function globalTeardown() {
  const dbName = process.env.E2E_DATABASE_NAME;
  if (!dbName || !/^chamber_e2e_\d+_\d+$/.test(dbName)) return;
  const base = parseEnv(readFileSync(resolve(__dirname, '../.env.test'), 'utf8')).DATABASE_URL!;
  const admin = new PrismaClient({ datasourceUrl: base });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}
