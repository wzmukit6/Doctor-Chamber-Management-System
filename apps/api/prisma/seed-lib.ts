import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  RoleKey,
  ROLES,
} from '@chamber/shared';

const ROLE_META: Record<RoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: { name: 'Super Admin', description: 'Platform administrator with system-wide access' },
  MANAGER: { name: 'Manager', description: 'Manages a chamber: staff, schedules, catalogues, billing and reports' },
  DOCTOR: { name: 'Doctor', description: 'Primary clinical user: consultations and prescriptions' },
  ASSISTANT: { name: 'Assistant', description: 'Front desk: registration, appointments, queue and payments' },
};

/** DEMO credentials — clearly fake, for local development and demos only. */
export const DEMO_PASSWORD = 'Demo@12345';

export const DEMO_USERS = {
  superAdmin: 'superadmin@demo.chamber.local',
  manager: 'manager@demo.chamber.local',
  doctor: 'doctor@demo.chamber.local',
  assistant: 'assistant@demo.chamber.local',
  managerB: 'manager.b@demo.chamber.local',
  doctorB: 'doctor.b@demo.chamber.local',
} as const;

/**
 * Idempotently syncs the permission catalogue and system roles.
 * Role→permission grants are only initialized for newly created roles so
 * that a super admin's runtime configuration is never overwritten.
 */
export async function syncRbac(prisma: PrismaClient) {
  for (const group of PERMISSION_GROUPS) {
    for (const key of group.permissions) {
      await prisma.permission.upsert({ where: { key }, update: { group: group.key }, create: { key, group: group.key } });
    }
  }
  const permissions = await prisma.permission.findMany();
  const byKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const key of Object.values(ROLES)) {
    const existing = await prisma.role.findUnique({ where: { key } });
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: ROLE_META[key].name, description: ROLE_META[key].description },
      create: { key, ...ROLE_META[key] },
    });
    // Super admin always holds everything (including newly added permissions).
    if (!existing || key === ROLES.SUPER_ADMIN) {
      await prisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: byKey.get(p)! })),
        skipDuplicates: true,
      });
    }
  }
}

export async function seedDemo(prisma: PrismaClient) {
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id])) as Record<RoleKey, string>;

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-health' },
    update: {},
    create: {
      name: 'Demo Health Care (DEMO)',
      slug: 'demo-health',
      email: 'info@demo.chamber.local',
      phone: '+8801700000000',
      address: 'House 1, Road 1, Dhanmondi, Dhaka (demo address)',
      isDemo: true,
    },
  });

  const chamberA = await prisma.chamber.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'DHN' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Demo Chamber — Dhanmondi',
      code: 'DHN',
      phone: '+8801700000001',
      email: 'dhanmondi@demo.chamber.local',
      address: 'Suite 3A, Demo Medical Tower, Dhanmondi, Dhaka',
      isDemo: true,
    },
  });
  const chamberB = await prisma.chamber.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'UTR' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Demo Chamber — Uttara',
      code: 'UTR',
      phone: '+8801700000002',
      email: 'uttara@demo.chamber.local',
      address: 'Sector 7, Uttara, Dhaka (demo address)',
      isDemo: true,
    },
  });

  const users: {
    email: string;
    fullName: string;
    phone: string;
    role: RoleKey;
    chamberId: string | null;
    doctor?: { qualifications: string; specialty: string; registrationNo: string; consultationFee: number; followUpFee: number };
  }[] = [
    { email: DEMO_USERS.superAdmin, fullName: 'Demo Super Admin', phone: '01700000010', role: 'SUPER_ADMIN', chamberId: null },
    { email: DEMO_USERS.manager, fullName: 'Demo Manager (Dhanmondi)', phone: '01700000011', role: 'MANAGER', chamberId: chamberA.id },
    {
      email: DEMO_USERS.doctor,
      fullName: 'Dr. Demo Rahman',
      phone: '01700000012',
      role: 'DOCTOR',
      chamberId: chamberA.id,
      doctor: {
        qualifications: 'MBBS, FCPS (Medicine)',
        specialty: 'Internal Medicine',
        registrationNo: 'BMDC-DEMO-0001',
        consultationFee: 800,
        followUpFee: 500,
      },
    },
    { email: DEMO_USERS.assistant, fullName: 'Demo Assistant (Dhanmondi)', phone: '01700000013', role: 'ASSISTANT', chamberId: chamberA.id },
    { email: DEMO_USERS.managerB, fullName: 'Demo Manager (Uttara)', phone: '01700000021', role: 'MANAGER', chamberId: chamberB.id },
    {
      email: DEMO_USERS.doctorB,
      fullName: 'Dr. Demo Karim',
      phone: '01700000022',
      role: 'DOCTOR',
      chamberId: chamberB.id,
      doctor: {
        qualifications: 'MBBS, MD (Paediatrics)',
        specialty: 'Paediatrics',
        registrationNo: 'BMDC-DEMO-0002',
        consultationFee: 1000,
        followUpFee: 600,
      },
    },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, fullName: u.fullName, phone: u.phone, passwordHash, isDemo: true },
    });
    const membership = await prisma.userRole.findFirst({ where: { userId: user.id, chamberId: u.chamberId } });
    if (!membership) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: roles[u.role],
          chamberId: u.chamberId,
          organizationId: u.chamberId ? org.id : null,
        },
      });
    }
    if (u.doctor && u.chamberId) {
      await prisma.doctor.upsert({
        where: { userId_chamberId: { userId: user.id, chamberId: u.chamberId } },
        update: {},
        create: { userId: user.id, chamberId: u.chamberId, ...u.doctor },
      });
    }
  }

  return { org, chamberA, chamberB };
}
