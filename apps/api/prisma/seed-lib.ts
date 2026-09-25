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

/** Weekly schedules for the demo doctors (chamber-local times). Friday is the weekly holiday. */
async function seedSchedules(prisma: PrismaClient) {
  const doctorA = await prisma.doctor.findFirst({ where: { user: { email: DEMO_USERS.doctor } } });
  const doctorB = await prisma.doctor.findFirst({ where: { user: { email: DEMO_USERS.doctorB } } });
  if (doctorA && (await prisma.doctorScheduleWindow.count({ where: { doctorId: doctorA.id } })) === 0) {
    const windows = [6, 0, 1, 2, 3, 4].flatMap((weekday) => [
      { doctorId: doctorA.id, weekday, startTime: '09:00', endTime: '13:00' },
      { doctorId: doctorA.id, weekday, startTime: '16:00', endTime: '22:00' },
    ]);
    await prisma.doctorScheduleWindow.createMany({ data: windows });
    await prisma.doctor.update({ where: { id: doctorA.id }, data: { slotMinutes: 15, maxDailyPatients: 40 } });
  }
  if (doctorB && (await prisma.doctorScheduleWindow.count({ where: { doctorId: doctorB.id } })) === 0) {
    await prisma.doctorScheduleWindow.createMany({
      data: [0, 1, 2, 3, 4].map((weekday) => ({ doctorId: doctorB.id, weekday, startTime: '15:00', endTime: '20:00' })),
    });
    await prisma.doctor.update({ where: { id: doctorB.id }, data: { slotMinutes: 20 } });
  }
}

/**
 * Demo appointments around "now" so the queue and calendar look alive whenever the
 * seed runs: finished visits, a patient with the doctor, patients waiting (one on
 * hold), later bookings, plus yesterday's and tomorrow's appointments.
 * Idempotent per day: skipped when today already has appointments.
 */
async function seedAppointments(prisma: PrismaClient) {
  const chamber = await prisma.chamber.findFirst({ where: { code: 'DHN', organization: { slug: 'demo-health' } } });
  const doctor = await prisma.doctor.findFirst({ where: { user: { email: DEMO_USERS.doctor } }, include: { user: true } });
  const assistant = await prisma.user.findUnique({ where: { email: DEMO_USERS.assistant } });
  if (!chamber || !doctor) return;
  const patients = await prisma.patient.findMany({ where: { chamberId: chamber.id, isDemo: true }, orderBy: { patientCode: 'asc' } });
  if (patients.length < 12) return;

  const slot = 15 * 60_000;
  const now = Date.now();
  const base = Math.floor(now / slot) * slot; // current 15-minute slot
  const tz = chamber.timezone;
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now));
  const dayStart = new Date(new Date(`${todayLocal}T00:00:00Z`).getTime() - offsetMinutes(tz, now) * 60_000);
  const existing = await prisma.appointment.count({ where: { chamberId: chamber.id, startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } });
  if (existing > 0) return;

  type Plan = { patient: number; offsetSlots: number; status: 'BOOKED' | 'CONFIRMED' | 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'; token?: number; hold?: boolean; visit?: 'NEW' | 'FOLLOW_UP'; reason?: string; day?: number };
  const plans: Plan[] = [
    { patient: 0, offsetSlots: -6, status: 'COMPLETED', token: 1, visit: 'FOLLOW_UP', reason: 'Diabetes follow-up' },
    { patient: 1, offsetSlots: -5, status: 'COMPLETED', token: 2, visit: 'FOLLOW_UP', reason: 'Thyroid review' },
    { patient: 2, offsetSlots: -3, status: 'IN_CONSULTATION', token: 3, visit: 'NEW', reason: 'Headache, BP check' },
    { patient: 3, offsetSlots: -2, status: 'WAITING', token: 4, visit: 'NEW', reason: 'Skin rash' },
    { patient: 4, offsetSlots: -1, status: 'WAITING', token: 5, hold: true, visit: 'NEW', reason: 'Fever for 3 days' },
    { patient: 5, offsetSlots: 0, status: 'WAITING', token: 6, visit: 'FOLLOW_UP', reason: 'Knee pain' },
    { patient: 6, offsetSlots: 2, status: 'CONFIRMED', visit: 'NEW', reason: 'Cough' },
    { patient: 7, offsetSlots: 4, status: 'BOOKED', visit: 'NEW', reason: 'Allergy consultation' },
    { patient: 8, offsetSlots: 6, status: 'BOOKED', visit: 'FOLLOW_UP' },
    // yesterday
    { patient: 9, offsetSlots: 0, status: 'COMPLETED', token: 1, day: -1, visit: 'NEW', reason: 'General check-up' },
    { patient: 10, offsetSlots: 1, status: 'COMPLETED', token: 2, day: -1, visit: 'FOLLOW_UP', reason: 'Cardiac follow-up' },
    { patient: 11, offsetSlots: 2, status: 'NO_SHOW', day: -1 },
    // tomorrow
    { patient: 0, offsetSlots: 0, status: 'BOOKED', day: 1, visit: 'FOLLOW_UP', reason: 'Report review' },
    { patient: 3, offsetSlots: 1, status: 'BOOKED', day: 1, visit: 'FOLLOW_UP' },
    { patient: 10, offsetSlots: 2, status: 'CONFIRMED', day: 1, visit: 'FOLLOW_UP' },
  ];

  for (const p of plans) {
    const startsAt = new Date(base + (p.day ?? 0) * 86_400_000 + p.offsetSlots * slot);
    const endsAt = new Date(startsAt.getTime() + slot);
    const checkedIn = p.token ? new Date(startsAt.getTime() - 10 * 60_000) : null;
    const patient = patients[p.patient]!;
    const appt = await prisma.appointment.create({
      data: {
        organizationId: chamber.organizationId,
        chamberId: chamber.id,
        patientId: patient.id,
        doctorId: doctor.id,
        startsAt,
        endsAt,
        status: p.status,
        visitType: p.visit ?? 'NEW',
        reason: p.reason ?? null,
        isDemo: true,
        checkedInAt: checkedIn,
        queuedAt: checkedIn,
        startedAt: ['IN_CONSULTATION', 'COMPLETED'].includes(p.status) ? startsAt : null,
        completedAt: p.status === 'COMPLETED' ? endsAt : null,
        createdById: assistant?.id ?? null,
        createdByName: assistant?.fullName ?? 'Demo seed',
        history: { create: [{ action: 'CREATED', toStatus: 'BOOKED', changedByName: assistant?.fullName ?? 'Demo seed', createdAt: new Date(startsAt.getTime() - 86_400_000) }] },
      },
    });
    if (p.status !== 'BOOKED') {
      await prisma.appointmentStatusHistory.create({
        data: { appointmentId: appt.id, action: 'STATUS_CHANGED', fromStatus: 'BOOKED', toStatus: p.status, changedByName: assistant?.fullName ?? 'Demo seed', createdAt: checkedIn ?? startsAt },
      });
    }
    if (p.token) {
      const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(startsAt);
      await prisma.queueToken.create({
        data: {
          chamberId: chamber.id,
          doctorId: doctor.id,
          appointmentId: appt.id,
          queueDate: new Date(`${localDay}T00:00:00Z`),
          scopeKey: doctor.id,
          tokenNumber: p.token,
          label: String(p.token),
          onHold: !!p.hold,
          calledAt: ['IN_CONSULTATION', 'COMPLETED'].includes(p.status) ? startsAt : null,
          callCount: ['IN_CONSULTATION', 'COMPLETED'].includes(p.status) ? 1 : 0,
        },
      });
      await prisma.$executeRaw`
        INSERT INTO queue_token_sequences (chamber_id, scope_key, queue_date, last_value)
        VALUES (${chamber.id}::uuid, ${doctor.id}, ${new Date(`${localDay}T00:00:00Z`)}::date, ${p.token})
        ON CONFLICT (chamber_id, scope_key, queue_date) DO UPDATE SET last_value = GREATEST(queue_token_sequences.last_value, EXCLUDED.last_value)`;
    }
  }
}

function offsetMinutes(timeZone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** Phase 3 demo data: doctor schedules and appointments around the current time. */
export async function seedDemoAppointments(prisma: PrismaClient) {
  await seedSchedules(prisma);
  await seedAppointments(prisma);
}

/**
 * Phase 4 demo data: finalized consultations for completed demo visits and a
 * draft for the patient currently with the doctor. Idempotent per appointment.
 */
export async function seedDemoConsultations(prisma: PrismaClient) {
  const doctor = await prisma.doctor.findFirst({ where: { user: { email: DEMO_USERS.doctor } }, include: { user: true } });
  if (!doctor) return;
  const appts = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, isDemo: true, status: { in: ['COMPLETED', 'IN_CONSULTATION'] }, consultation: null },
    include: { patient: true },
    orderBy: { startsAt: 'asc' },
  });
  const dx = await prisma.diagnosisCatalog.findMany({ where: { chamberId: null } });
  const inv = await prisma.investigationCatalog.findMany({ where: { chamberId: null } });
  const cc = await prisma.complaintCatalog.findMany({ where: { chamberId: null } });
  const vitals = await prisma.vitalDefinition.findMany({ where: { chamberId: null } });
  const find = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name === name);
  const vital = (key: string) => vitals.find((v) => v.key === key)!;

  const plans: Record<string, { complaints: [string, string][]; diagnoses: string[]; investigations: string[]; exam: string; bp: string; pulse: number; temp: number; weight: number; followUpDays?: number; advice?: string }> = {
    'Diabetes follow-up': { complaints: [['Weakness', '2 weeks']], diagnoses: ['Type 2 diabetes mellitus', 'Essential (primary) hypertension'], investigations: ['HbA1c', 'Serum creatinine', 'Lipid profile'], exam: 'No pedal oedema. Peripheral pulses palpable.', bp: '138/86', pulse: 78, temp: 98.4, weight: 76.5, followUpDays: 30 },
    'Thyroid review': { complaints: [['Weakness', '1 month'], ['Weight loss', '1 month']], diagnoses: ['Hypothyroidism, unspecified'], investigations: ['Serum TSH'], exam: 'No goitre.', bp: '118/76', pulse: 70, temp: 98.2, weight: 61.0, followUpDays: 60 },
    'General check-up': { complaints: [['Body ache', '3 days']], diagnoses: ['Viral infection, unspecified'], investigations: ['Complete blood count'], exam: 'Throat mildly congested.', bp: '122/80', pulse: 84, temp: 99.1, weight: 70.2, followUpDays: 7 },
    'Cardiac follow-up': { complaints: [['Chest pain', 'occasional, 2 weeks'], ['Shortness of breath', 'on exertion']], diagnoses: ['Chronic ischaemic heart disease', 'Chronic kidney disease, stage 3'], investigations: ['Electrocardiogram', 'Serum creatinine', 'Serum electrolytes'], exam: 'S1 S2 normal, no murmur. Mild bilateral basal crepitations.', bp: '132/84', pulse: 72, temp: 98.3, weight: 68.4, followUpDays: 14 },
    'Headache, BP check': { complaints: [['Headache', '5 days'], ['Dizziness', '2 days']], diagnoses: [], investigations: [], exam: '', bp: '150/96', pulse: 88, temp: 98.6, weight: 81.0 },
  };

  for (const appt of appts) {
    const plan = plans[appt.reason ?? ''] ?? plans['General check-up']!;
    const finalized = appt.status === 'COMPLETED';
    const previous = await prisma.consultation.count({ where: { patientId: appt.patientId } });
    const followUp = finalized && plan.followUpDays ? new Date(appt.startsAt.getTime() + plan.followUpDays * 86_400_000) : null;
    // Children are inserted while DRAFT; finalization happens last (finalized consultations are immutable).
    const c = await prisma.consultation.create({
      data: {
        organizationId: appt.organizationId,
        chamberId: appt.chamberId,
        patientId: appt.patientId,
        doctorId: doctor.id,
        appointmentId: appt.id,
        visitNumber: previous + 1,
        presentIllness: plan.complaints.map(([c, d]) => `${c} for ${d}`).join('. ') + '.',
        examinationNotes: plan.exam || null,
        followUpDate: followUp ? new Date(`${followUp.toISOString().slice(0, 10)}T00:00:00Z`) : null,
        followUpInstructions: followUp ? 'Come with the investigation reports.' : null,
        startedAt: appt.startedAt ?? appt.startsAt,
        isDemo: true,
        createdById: doctor.userId,
        symptoms: { create: plan.complaints.map(([text, duration], i) => ({ text, duration, complaintId: find(cc, text)?.id ?? null, sortOrder: i })) },
        diagnoses: {
          create: plan.diagnoses.map((name, i) => {
            const d = find(dx, name);
            return { name, code: d?.code ?? null, diagnosisId: d?.id ?? null, isPrimary: i === 0, sortOrder: i };
          }),
        },
        investigations: { create: plan.investigations.map((name, i) => ({ name, investigationId: find(inv, name)?.id ?? null, sortOrder: i })) },
        vitals: {
          create: [
            { definitionId: vital('bp').id, valueText: plan.bp, valueNumber: Number(plan.bp.split('/')[0]), valueNumber2: Number(plan.bp.split('/')[1]) },
            { definitionId: vital('pulse').id, valueText: String(plan.pulse), valueNumber: plan.pulse },
            { definitionId: vital('temperature').id, valueText: plan.temp.toFixed(1), valueNumber: plan.temp },
            { definitionId: vital('weight').id, valueText: plan.weight.toFixed(1), valueNumber: plan.weight },
          ].map((v) => ({ ...v, recordedByName: 'Demo Assistant (Dhanmondi)' })),
        },
      },
    });
    if (finalized) {
      await prisma.consultation.update({
        where: { id: c.id },
        data: { status: 'FINALIZED', finalizedAt: appt.completedAt ?? appt.endsAt, finalizedById: doctor.userId, finalizedByName: doctor.user.fullName },
      });
    }
  }
}
