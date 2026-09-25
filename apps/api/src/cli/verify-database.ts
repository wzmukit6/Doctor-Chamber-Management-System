/**
 * Database integrity check (spec §47 "backup verification"). Used on a freshly
 * restored backup and as a periodic production check:
 *
 *   DATABASE_URL=postgresql://… node dist/cli/verify-database.js [--expect manifest.json]
 *
 * Verifies that every migration is applied, the audit hash chain is intact and
 * the core tables are readable, and (with --expect) that row counts match the
 * manifest written at backup time. Prints a JSON report; exits 1 on failure.
 * Never prints row contents.
 */
import '../load-env';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../modules/audit/audit.service';

export const CORE_TABLES = [
  'organizations',
  'chambers',
  'users',
  'patients',
  'appointments',
  'consultations',
  'prescriptions',
  'prescription_versions',
  'invoices',
  'payments',
  'audit_logs',
] as const;

async function main() {
  const expectIdx = process.argv.indexOf('--expect');
  const manifest = expectIdx > 0 ? (JSON.parse(readFileSync(process.argv[expectIdx + 1], 'utf8')) as { counts?: Record<string, number> }) : null;
  const prisma = new PrismaService();
  const failures: string[] = [];
  try {
    const [migrations] = await prisma.$queryRaw<{ applied: number; failed: number; latest: string | null }[]>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
             count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed,
             max(migration_name) FILTER (WHERE finished_at IS NOT NULL) AS latest
      FROM _prisma_migrations`;
    if (migrations.failed > 0) failures.push(`${migrations.failed} failed migration(s)`);

    const counts: Record<string, number> = {};
    for (const table of CORE_TABLES) {
      const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}"`);
      counts[table] = row.n;
      const expected = manifest?.counts?.[table];
      if (expected !== undefined && expected !== row.n) failures.push(`${table}: expected ${expected} rows, found ${row.n}`);
    }

    const chain = await new AuditService(prisma).verifyChain();
    if (!chain.valid) failures.push(`audit chain broken at seq ${chain.brokenAtSeq}`);

    const report = { ok: failures.length === 0, failures, migrations, auditChain: chain, counts, checkedAt: new Date().toISOString() };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`verify-database failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
