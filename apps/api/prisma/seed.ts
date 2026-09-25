import { PrismaClient } from '@prisma/client';
import { syncReferenceData } from './reference-data';
import { DEMO_PASSWORD, DEMO_USERS, seedDemo, seedDemoAppointments, seedDemoConsultations, seedDemoPatients, seedDemoPrescriptions, syncRbac } from './seed-lib';

/**
 * `npm run db:seed` — syncs RBAC and (unless SEED_DEMO=false) creates
 * clearly-marked demo data. Never contains real patient information.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    await syncRbac(prisma);
    console.log('✔ Roles and permissions synchronized');
    await syncReferenceData(prisma);
    console.log('✔ Clinical reference data (diagnoses, investigations, complaints, vital fields, medicines) synchronized');
    if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(prisma);
      console.log('✔ Demo organization, chambers and users created');
      await seedDemoPatients(prisma);
      console.log('✔ Demo patients created (marked as demo data)');
      await seedDemoAppointments(prisma);
      console.log("✔ Demo schedules and today's appointments/queue created");
      await seedDemoConsultations(prisma);
      console.log('✔ Demo consultations created');
      await seedDemoPrescriptions(prisma);
      console.log('✔ Demo prescriptions created (one revised)');
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
