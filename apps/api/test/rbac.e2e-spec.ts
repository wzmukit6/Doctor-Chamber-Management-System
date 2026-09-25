import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

/**
 * Authorization test matrix (spec §48, §50): every role against protected
 * endpoints, plus cross-chamber isolation. All checks hit the real API.
 */
describe('RBAC & tenant isolation (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let superAdmin: Session;
  let managerA: Session;
  let doctorA: Session;
  let assistantA: Session;
  let chamberA: string;
  let chamberB: string;
  let doctorBUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    [superAdmin, managerA, doctorA, assistantA] = await Promise.all([
      login(app, DEMO_USERS.superAdmin),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.assistant),
    ]);
    chamberA = (await prisma.chamber.findFirstOrThrow({ where: { code: 'DHN' } })).id;
    chamberB = (await prisma.chamber.findFirstOrThrow({ where: { code: 'UTR' } })).id;
    doctorBUserId = (await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.doctorB } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('permission matrix', () => {
    const cases: [string, 'get' | 'post' | 'put', string, Record<string, number>][] = [
      ['list users', 'get', '/api/users', { superAdmin: 200, managerA: 200, doctorA: 403, assistantA: 403 }],
      ['list roles', 'get', '/api/roles', { superAdmin: 200, managerA: 200, doctorA: 403, assistantA: 403 }],
      ['list organizations', 'get', '/api/organizations', { superAdmin: 200, managerA: 403, doctorA: 403, assistantA: 403 }],
      ['create chamber', 'post', '/api/chambers', { managerA: 403, doctorA: 403, assistantA: 403 }],
      ['create organization', 'post', '/api/organizations', { managerA: 403, doctorA: 403, assistantA: 403 }],
      ['verify audit chain', 'get', '/api/audit-logs/verify', { superAdmin: 200, managerA: 403, doctorA: 403, assistantA: 403 }],
      ['view audit logs', 'get', '/api/audit-logs', { superAdmin: 200, managerA: 200, doctorA: 200, assistantA: 403 }],
      ['list chambers', 'get', '/api/chambers', { superAdmin: 200, managerA: 200, doctorA: 200, assistantA: 200 }],
    ];

    it.each(cases)('%s', async (_name, method, url, expected) => {
      const sessions: Record<string, Session> = { superAdmin, managerA, doctorA, assistantA };
      for (const [who, status] of Object.entries(expected)) {
        const res = await sessions[who][method](url, method === 'get' ? undefined : {});
        expect({ who, status: res.status }).toEqual({ who, status });
      }
    });

    it('doctor cannot access system role configuration', async () => {
      const roles = await superAdmin.get('/api/roles');
      const doctorRole = roles.body.data.find((r: { key: string }) => r.key === 'DOCTOR');
      const res = await doctorA.put(`/api/roles/${doctorRole.id}/permissions`, { permissions: [], reason: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('cross-chamber isolation', () => {
    it('manager A only sees users of chamber A', async () => {
      const res = await managerA.get('/api/users?pageSize=100');
      expect(res.status).toBe(200);
      const emails = res.body.data.map((u: { email: string }) => u.email);
      expect(emails).toContain(DEMO_USERS.doctor);
      expect(emails).not.toContain(DEMO_USERS.doctorB);
      expect(emails).not.toContain(DEMO_USERS.superAdmin);
      for (const u of res.body.data) {
        for (const m of u.memberships) expect(m.chamber.id).toBe(chamberA);
      }
    });

    it('manager A cannot read or modify a chamber B user (reported as not found)', async () => {
      expect((await managerA.get(`/api/users/${doctorBUserId}`)).status).toBe(404);
      const upd = await managerA.patch(`/api/users/${doctorBUserId}`, { fullName: 'Hacked', version: 1 });
      expect(upd.status).toBe(404);
      const status = await managerA.post(`/api/users/${doctorBUserId}/status`, { isActive: false, reason: 'test' });
      expect(status.status).toBe(404);
    });

    it('manager A cannot read or update chamber B', async () => {
      expect((await managerA.get(`/api/chambers/${chamberB}`)).status).toBe(404);
      expect((await managerA.patch(`/api/chambers/${chamberB}`, { name: 'X', version: 1 })).status).toBe(404);
      const list = await managerA.get('/api/chambers');
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([chamberA]);
    });

    it('manager A cannot create users in chamber B', async () => {
      const res = await managerA.post('/api/users', {
        fullName: 'Intruder',
        email: uniqueEmail('intruder'),
        password: STRONG_PASSWORD,
        role: 'ASSISTANT',
        chamberId: chamberB,
      });
      expect(res.status).toBe(404);
    });

    it('audit logs are scoped: manager sees own chamber, doctor sees own actions', async () => {
      const m = await managerA.get('/api/audit-logs?pageSize=100');
      for (const row of m.body.data) expect(row.chamberId).toBe(chamberA);
      const d = await doctorA.get('/api/audit-logs?pageSize=100');
      const doctorId = (await doctorA.get('/api/auth/me')).body.data.id;
      for (const row of d.body.data) expect(row.userId).toBe(doctorId);
      for (const row of d.body.data) expect(row.ipAddress).toBeNull();
    });
  });

  describe('user management rules', () => {
    it('manager cannot create managers or super admins', async () => {
      for (const role of ['MANAGER', 'SUPER_ADMIN']) {
        const res = await managerA.post('/api/users', {
          fullName: 'Escalation',
          email: uniqueEmail('escalate'),
          password: STRONG_PASSWORD,
          role,
          chamberId: chamberA,
        });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ROLE_NOT_MANAGEABLE');
      }
    });

    it('manager creates a doctor in own chamber with a doctor profile, and it is audited', async () => {
      const email = uniqueEmail('doctor');
      const res = await managerA.post('/api/users', {
        fullName: 'Dr. Test',
        email,
        phone: '01711111111',
        password: STRONG_PASSWORD,
        role: 'DOCTOR',
        doctorProfile: { specialty: 'Cardiology', consultationFee: 900 },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.memberships[0].chamber.id).toBe(chamberA);
      expect(res.body.data.doctorProfile.specialty).toBe('Cardiology');
      const audit = await prisma.auditLog.findFirst({ where: { action: 'user.created', resourceId: res.body.data.id } });
      expect(audit?.role).toBe('MANAGER');
      expect(JSON.stringify(audit?.newValue)).not.toContain('password');
    });

    it('rejects duplicate emails', async () => {
      const res = await managerA.post('/api/users', {
        fullName: 'Dup',
        email: DEMO_USERS.doctor,
        password: STRONG_PASSWORD,
        role: 'ASSISTANT',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE');
    });

    it('uses optimistic locking for concurrent updates', async () => {
      const created = await managerA.post('/api/users', {
        fullName: 'Lock Test',
        email: uniqueEmail('lock'),
        password: STRONG_PASSWORD,
        role: 'ASSISTANT',
      });
      const { id, version } = created.body.data;
      const first = await managerA.patch(`/api/users/${id}`, { fullName: 'Edit One', version });
      expect(first.status).toBe(200);
      const stale = await managerA.patch(`/api/users/${id}`, { fullName: 'Edit Two', version });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');
    });

    it('deactivation requires a reason, revokes sessions, and blocks login', async () => {
      const email = uniqueEmail('deact');
      const created = await managerA.post('/api/users', {
        fullName: 'To Deactivate',
        email,
        password: STRONG_PASSWORD,
        role: 'ASSISTANT',
      });
      const userSession = await login(app, email, STRONG_PASSWORD);
      const noReason = await managerA.post(`/api/users/${created.body.data.id}/status`, { isActive: false });
      expect(noReason.status).toBe(422);
      const res = await managerA.post(`/api/users/${created.body.data.id}/status`, { isActive: false, reason: 'Left job' });
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
      expect((await userSession.get('/api/auth/me')).status).toBe(401);
      await expect(login(app, email, STRONG_PASSWORD)).rejects.toThrow();
    });

    it('users cannot deactivate themselves', async () => {
      const me = (await managerA.get('/api/auth/me')).body.data;
      const res = await managerA.post(`/api/users/${me.id}/status`, { isActive: false, reason: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('chambers & organizations', () => {
    it('manager may edit own chamber profile but not deactivate it', async () => {
      const current = (await managerA.get(`/api/chambers/${chamberA}`)).body.data;
      const ok = await managerA.patch(`/api/chambers/${chamberA}`, { phone: '01799999999', version: current.version });
      expect(ok.status).toBe(200);
      const deactivate = await managerA.patch(`/api/chambers/${chamberA}`, { isActive: false, version: ok.body.data.version });
      expect(deactivate.status).toBe(403);
    });

    it('super admin creates an organization, chamber and manager', async () => {
      const org = await superAdmin.post('/api/organizations', { name: 'Test Org', slug: `test-org-${Date.now()}` });
      expect(org.status).toBe(201);
      const chamber = await superAdmin.post('/api/chambers', {
        organizationId: org.body.data.id,
        name: 'Test Chamber',
        code: 'TST',
      });
      expect(chamber.status).toBe(201);
      const manager = await superAdmin.post('/api/users', {
        fullName: 'New Manager',
        email: uniqueEmail('manager'),
        password: STRONG_PASSWORD,
        role: 'MANAGER',
        chamberId: chamber.body.data.id,
      });
      expect(manager.status).toBe(201);
      const del = await superAdmin.del(`/api/organizations/${org.body.data.id}`, { reason: 'cleanup' });
      expect(del.status).toBe(409); // still has chambers
    });
  });

  describe('role configuration', () => {
    it('forbidden grants are rejected even for super admin', async () => {
      const roles = (await superAdmin.get('/api/roles')).body.data;
      const assistant = roles.find((r: { key: string }) => r.key === 'ASSISTANT');
      const res = await superAdmin.put(`/api/roles/${assistant.id}/permissions`, {
        permissions: [...assistant.permissions, 'prescriptions.finalize'],
        reason: 'test',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('GRANT_NOT_ALLOWED');

      const superRole = roles.find((r: { key: string }) => r.key === 'SUPER_ADMIN');
      const res2 = await superAdmin.put(`/api/roles/${superRole.id}/permissions`, { permissions: [], reason: 'test' });
      expect(res2.status).toBe(403);
    });

    it('permission changes take effect server-side and are audited', async () => {
      const roles = (await superAdmin.get('/api/roles')).body.data;
      const assistant = roles.find((r: { key: string }) => r.key === 'ASSISTANT');
      const without = assistant.permissions.filter((p: string) => p !== 'chambers.view');
      const res = await superAdmin.put(`/api/roles/${assistant.id}/permissions`, { permissions: without, reason: 'test revoke' });
      expect(res.status).toBe(200);
      const fresh = await login(app, DEMO_USERS.assistant);
      // AuthorizationService caches for 30s per process; the update invalidates it immediately.
      expect((await fresh.get('/api/chambers')).status).toBe(403);
      await superAdmin.put(`/api/roles/${assistant.id}/permissions`, { permissions: assistant.permissions, reason: 'restore' });
      expect((await fresh.get('/api/chambers')).status).toBe(200);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'role.permissions_updated', reason: 'test revoke' } });
      expect(audit).not.toBeNull();
    });
  });

  describe('audit trail integrity', () => {
    it('hash chain verifies', async () => {
      const res = await superAdmin.get('/api/audit-logs/verify');
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.checked).toBeGreaterThan(0);
    });

    it('database refuses to update or delete audit rows', async () => {
      await expect(prisma.$executeRawUnsafe(`UPDATE audit_logs SET reason = 'tampered'`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    });
  });
});
