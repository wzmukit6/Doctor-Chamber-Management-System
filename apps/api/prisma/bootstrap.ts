import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_PASSWORD_POLICY, passwordIssues } from '@chamber/shared';
import { syncReferenceData } from './reference-data';
import { syncRbac } from './seed-lib';

/**
 * Production bootstrap — safe to run on every deploy (idempotent), never creates demo data:
 *  1. synchronizes roles/permissions and clinical reference data;
 *  2. if no super administrator exists yet, creates one from
 *     BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD_FILE
 *     (a file, so the password never appears in the environment or process list).
 *     The account must change its password at first sign-in.
 *
 *   node dist-seed/prisma/bootstrap.js
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    await syncRbac(prisma);
    await syncReferenceData(prisma);
    console.log('bootstrap: roles, permissions and reference data synchronized');

    const superAdmin = await prisma.userRole.findFirst({ where: { role: { key: 'SUPER_ADMIN' }, isActive: true, user: { deletedAt: null } } });
    if (superAdmin) {
      console.log('bootstrap: super administrator present — nothing else to do');
      return;
    }
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Platform Administrator';
    const passwordFile = process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE;
    if (!email || !passwordFile) {
      console.warn('bootstrap: no super administrator yet — set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD_FILE and run again');
      process.exitCode = 2;
      return;
    }
    const password = readFileSync(passwordFile, 'utf8').trim();
    const issues = passwordIssues(password, { ...DEFAULT_PASSWORD_POLICY, passwordMinLength: Math.max(DEFAULT_PASSWORD_POLICY.passwordMinLength, 12) });
    if (issues.length) throw new Error(`bootstrap password is too weak: ${issues.join(', ')}`);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, fullName, passwordHash, mustChangePassword: true } });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id, chamberId: null, organizationId: null } });
    });
    console.log(`bootstrap: super administrator ${email} created (must change password at first sign-in)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
