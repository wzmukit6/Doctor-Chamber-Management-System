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

type DemoPatient = {
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  dob?: string;
  age?: number;
  blood?: string;
  occupation?: string;
  address: string;
  allergies?: { allergen: string; reaction?: string; severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN' }[];
  history?: { existingConditions?: string; currentMedications?: string; familyHistory?: string; lifestyle?: string; previousSurgeries?: string };
  emergency?: { name: string; relation: string };
};

/** Fictional demo patients. Names are common generic names; phones use the reserved-looking 0170000xxxx range. */
const DEMO_PATIENTS: DemoPatient[] = [
  { fullName: 'Abdul Karim', gender: 'MALE', dob: '1968-04-12', blood: 'B+', occupation: 'Businessman', address: 'Dhanmondi 27, Dhaka',
    history: { existingConditions: 'Type 2 diabetes mellitus (2015); Hypertension', currentMedications: 'Metformin 500 mg BD; Amlodipine 5 mg OD', familyHistory: 'Father: diabetes', lifestyle: 'Ex-smoker (quit 2018), walks 30 min daily' },
    allergies: [{ allergen: 'Penicillin', reaction: 'Skin rash', severity: 'MODERATE' }], emergency: { name: 'Salma Karim', relation: 'Wife' } },
  { fullName: 'Salma Begum', gender: 'FEMALE', dob: '1975-11-02', blood: 'O+', occupation: 'Teacher', address: 'Mohammadpur, Dhaka',
    history: { existingConditions: 'Hypothyroidism', currentMedications: 'Levothyroxine 50 mcg OD' } },
  { fullName: 'Rafiqul Islam', gender: 'MALE', age: 52, blood: 'A+', occupation: 'Government service', address: 'Lalmatia, Dhaka',
    history: { existingConditions: 'Hypertension', previousSurgeries: 'Appendectomy (1995)' } },
  { fullName: 'Nasrin Akter', gender: 'FEMALE', dob: '1990-06-21', blood: 'AB+', occupation: 'Banker', address: 'Kalabagan, Dhaka',
    allergies: [{ allergen: 'Sulfa drugs', reaction: 'Urticaria', severity: 'SEVERE' }] },
  { fullName: 'Mohammad Hasan', gender: 'MALE', dob: '1985-01-30', blood: 'B-', occupation: 'Engineer', address: 'Jigatola, Dhaka' },
  { fullName: 'Fatema Khatun', gender: 'FEMALE', age: 67, blood: 'O-', occupation: 'Homemaker', address: 'Hazaribagh, Dhaka',
    history: { existingConditions: 'Osteoarthritis (knees); Type 2 diabetes', currentMedications: 'Gliclazide 80 mg BD' }, emergency: { name: 'Jamal Uddin', relation: 'Son' } },
  { fullName: 'Tanvir Ahmed', gender: 'MALE', dob: '1998-09-15', blood: 'A-', occupation: 'Student', address: 'Science Lab, Dhaka',
    history: { lifestyle: 'Smoker, 5 cigarettes/day' } },
  { fullName: 'Ayesha Siddika', gender: 'FEMALE', dob: '2016-03-08', blood: 'B+', address: 'Dhanmondi 15, Dhaka',
    allergies: [{ allergen: 'Peanuts', reaction: 'Swelling of lips', severity: 'SEVERE' }], emergency: { name: 'Rashida Siddika', relation: 'Mother' } },
  { fullName: 'Jahangir Alam', gender: 'MALE', age: 45, occupation: 'Driver', address: 'Rayer Bazar, Dhaka' },
  { fullName: 'Shirin Sultana', gender: 'FEMALE', dob: '1982-12-25', blood: 'A+', occupation: 'Nurse', address: 'Green Road, Dhaka' },
  { fullName: 'Kamal Hossain', gender: 'MALE', dob: '1959-07-04', blood: 'O+', occupation: 'Retired', address: 'Shyamoli, Dhaka',
    history: { existingConditions: 'Ischaemic heart disease; CKD stage 3', currentMedications: 'Aspirin 75 mg OD; Atorvastatin 20 mg OD', previousSurgeries: 'PCI (2019)' } },
  { fullName: 'Rumana Parvin', gender: 'FEMALE', dob: '1993-02-14', occupation: 'Designer', address: 'Panthapath, Dhaka' },
];

const DEMO_PATIENTS_B: DemoPatient[] = [
  { fullName: 'Arif Chowdhury', gender: 'MALE', dob: '2019-05-10', blood: 'B+', address: 'Sector 4, Uttara, Dhaka', emergency: { name: 'Lima Chowdhury', relation: 'Mother' } },
  { fullName: 'Mitu Rahman', gender: 'FEMALE', dob: '2021-10-01', address: 'Sector 11, Uttara, Dhaka',
    allergies: [{ allergen: 'Cow milk protein', reaction: 'Vomiting', severity: 'MILD' }] },
  { fullName: 'Sabbir Hossain', gender: 'MALE', age: 9, address: 'Sector 13, Uttara, Dhaka' },
];

async function seedPatientsFor(prisma: PrismaClient, chamber: { id: string; code: string; organizationId: string }, list: DemoPatient[], phoneBase: number, createdById: string | null) {
  if ((await prisma.patient.count({ where: { chamberId: chamber.id } })) > 0) return;
  const today = new Date();
  for (const [i, p] of list.entries()) {
    const seqRows = await prisma.$queryRaw<{ last_value: number }[]>`
      INSERT INTO patient_code_sequences (chamber_id, last_value) VALUES (${chamber.id}::uuid, 1)
      ON CONFLICT (chamber_id) DO UPDATE SET last_value = patient_code_sequences.last_value + 1
      RETURNING last_value`;
    const phone = `0170000${String(phoneBase + i).padStart(4, '0')}`;
    const dob = p.dob
      ? new Date(`${p.dob}T00:00:00Z`)
      : new Date(Date.UTC(today.getUTCFullYear() - (p.age ?? 30), today.getUTCMonth(), today.getUTCDate()));
    await prisma.patient.create({
      data: {
        organizationId: chamber.organizationId,
        chamberId: chamber.id,
        patientCode: `${chamber.code}-${String(seqRows[0]!.last_value).padStart(5, '0')}`,
        fullName: p.fullName,
        gender: p.gender,
        dateOfBirth: dob,
        dobEstimated: !p.dob,
        bloodGroup: p.blood ?? null,
        phone,
        phoneSearch: phone,
        address: p.address,
        occupation: p.occupation ?? null,
        nationality: 'Bangladeshi',
        isDemo: true,
        createdById,
        // Spread registrations over the last few months so lists and timelines look realistic.
        createdAt: new Date(Date.now() - (list.length - i) * 6 * 86_400_000),
        contacts: p.emergency
          ? { create: [{ name: p.emergency.name, relation: p.emergency.relation, phone: `0170009${String(phoneBase + i).padStart(4, '0')}` }] }
          : undefined,
        allergies: p.allergies ? { create: p.allergies } : undefined,
        medicalHistory: p.history ? { create: { ...p.history, updatedByName: 'Demo seed' } } : undefined,
      },
    });
  }
}

/** Demo patients for both demo chambers (idempotent: skipped when a chamber already has patients). */
export async function seedDemoPatients(prisma: PrismaClient) {
  const org = await prisma.organization.findUnique({ where: { slug: 'demo-health' } });
  if (!org) return;
  const chamberA = await prisma.chamber.findFirst({ where: { organizationId: org.id, code: 'DHN' } });
  const chamberB = await prisma.chamber.findFirst({ where: { organizationId: org.id, code: 'UTR' } });
  const assistant = await prisma.user.findUnique({ where: { email: DEMO_USERS.assistant } });
  const doctorB = await prisma.user.findUnique({ where: { email: DEMO_USERS.doctorB } });
  if (chamberA) await seedPatientsFor(prisma, chamberA, DEMO_PATIENTS, 100, assistant?.id ?? null);
  if (chamberB) await seedPatientsFor(prisma, chamberB, DEMO_PATIENTS_B, 500, doctorB?.id ?? null);
}
