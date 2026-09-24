import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedDemo, seedDemoPatients, syncRbac } from '../prisma/seed-lib';
import { applyTestEnv } from './load-env';

/**
 * Creates a fresh, uniquely named database for this test run, applies all
 * migrations (`prisma migrate deploy`, non-destructive) and seeds demo data.
 * The database is dropped again in global-teardown. Existing databases are never touched.
 */
export default async function globalSetup() {
  delete process.env.E2E_DATABASE_URL;
  applyTestEnv();
  const baseUrl = new URL(process.env.DATABASE_URL!);
  const dbName = `chamber_e2e_${Date.now()}_${process.pid}`;

  const admin = new PrismaClient({ datasourceUrl: baseUrl.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  const e2eUrl = new URL(baseUrl.toString());
  e2eUrl.pathname = `/${dbName}`;
  process.env.E2E_DATABASE_URL = e2eUrl.toString();
  process.env.E2E_DATABASE_NAME = dbName;
  process.env.DATABASE_URL = e2eUrl.toString();

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasourceUrl: e2eUrl.toString() });
  try {
    await syncRbac(prisma);
    await seedDemo(prisma);
    await seedDemoPatients(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
