import { PrismaClient } from '@prisma/client';
import { DEMO_PASSWORD, DEMO_USERS, seedDemo, syncRbac } from './seed-lib';

/**
 * `npm run db:seed` — syncs RBAC and (unless SEED_DEMO=false) creates
 * clearly-marked demo data. Never contains real patient information.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    await syncRbac(prisma);
    console.log('✔ Roles and permissions synchronized');
    if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(prisma);
      console.log('✔ Demo organization, chambers and users created');
      console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}):`);
      for (const [role, email] of Object.entries(DEMO_USERS)) console.log(`  ${role.padEnd(12)} ${email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
