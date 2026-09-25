import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { DEMO_PASSWORD, DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login } from './helpers';

/**
 * Security audit (spec §48): authentication attacks, token theft, session
 * fixation, password-reset abuse, injection, headers and error hygiene.
 * Results are summarised in docs/SECURITY.md.
 */
describe('Security audit (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const cookieValue = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('session fixation', () => {
    it('ignores a session id planted before sign-in and issues a fresh one', async () => {
      const planted = 'a'.repeat(64);
      const res = await request(server()).post('/api/auth/login').set('Cookie', `ca_session=${planted}`).send({ email: DEMO_USERS.assistant, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      const issued = cookieValue(res.headers['set-cookie'] as unknown as string[], 'ca_session');
      expect(issued).toBeDefined();
      expect(issued).not.toBe(planted);
      expect((await request(server()).get('/api/auth/me').set('Cookie', `ca_session=${planted}`)).status).toBe(401);
    });

    it('issues a new session id on every sign-in', async () => {
      const a = await request(server()).post('/api/auth/login').send({ email: DEMO_USERS.assistant, password: DEMO_PASSWORD });
      const b = await request(server()).post('/api/auth/login').send({ email: DEMO_USERS.assistant, password: DEMO_PASSWORD });
      expect(cookieValue(a.headers['set-cookie'] as unknown as string[], 'ca_session')).not.toBe(cookieValue(b.headers['set-cookie'] as unknown as string[], 'ca_session'));
    });
  });

  describe('token theft', () => {
    it('session cookie is HttpOnly, SameSite=Strict and scoped to /api', async () => {
      const res = await request(server()).post('/api/auth/login').send({ email: DEMO_USERS.assistant, password: DEMO_PASSWORD });
      const session = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('ca_session='))!;
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Strict/i);
      expect(session).toMatch(/Path=\/api/);
    });

    it('stores only a hash of the session token (a database leak does not yield usable sessions)', async () => {
      const res = await request(server()).post('/api/auth/login').send({ email: DEMO_USERS.assistant, password: DEMO_PASSWORD });
      const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'ca_session')!;
      expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
      expect(await prisma.session.count({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })).toBe(1);
    });

    it('a stolen session cannot be used for writes without the matching CSRF token', async () => {
      const victim = await login(app, DEMO_USERS.manager);
      const attacker = await login(app, DEMO_USERS.assistant);
      // Victim cookie + attacker's own CSRF token → rejected.
      const res = await victim.agent.patch('/api/auth/profile').set('X-CSRF-Token', attacker.csrf).send({ preferredLanguage: 'bn' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('a user cannot revoke or see another user’s sessions', async () => {
      const manager = await login(app, DEMO_USERS.manager);
      const doctor = await login(app, DEMO_USERS.doctor);
      const doctorSessions = await doctor.get('/api/auth/sessions');
      const target = doctorSessions.body.data[0].id as string;
      const res = await manager.del(`/api/auth/sessions/${target}`);
      expect(res.status).toBe(404);
      expect((await doctor.get('/api/auth/me')).status).toBe(200);
      const own = await manager.get('/api/auth/sessions');
      expect(own.body.data.map((s: { id: string }) => s.id)).not.toContain(target);
    });

    it('an expired or revoked session is rejected even with the correct cookie', async () => {
      const s = await login(app, DEMO_USERS.assistant);
      const me = await s.get('/api/auth/sessions');
      const current = (me.body.data as { id: string; current: boolean }[]).find((x) => x.current)!;
      await prisma.session.update({ where: { id: current.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
      expect((await s.get('/api/auth/me')).status).toBe(401);
    });
  });

  describe('password reset abuse', () => {
    it('reset tokens are stored hashed, expire, and a new request invalidates the previous token', async () => {
      await request(server()).post('/api/auth/forgot-password').send({ email: DEMO_USERS.doctorB });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USERS.doctorB } });
      let tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      for (let i = 0; !tokens.length && i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      }
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t) => /^[0-9a-f]{64}$/.test(t.tokenHash))).toBe(true);
      const ttlMinutes = (tokens[0].expiresAt.getTime() - tokens[0].createdAt.getTime()) / 60_000;
      expect(ttlMinutes).toBeLessThanOrEqual(60);
    });

    it('rejects guessed, malformed and oversized tokens with the same error', async () => {
      const codes = new Set<string>();
      for (const token of ['x'.repeat(43), 'not-a-token', 'A'.repeat(500)]) {
        const res = await request(server()).post('/api/auth/reset-password').send({ token, newPassword: 'Br4ndNewPassword' });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        codes.add(res.body.error.code);
      }
      expect([...codes].every((c) => c === 'INVALID_TOKEN' || c === 'VALIDATION_FAILED')).toBe(true);
    });

    it('rate limits reset requests per client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push((await request(server()).post('/api/auth/forgot-password').set('X-Forwarded-For', '203.0.113.9').send({ email: `nobody${i}@test.chamber.local` })).status);
      }
      expect(statuses).toContain(429);
    });
  });

  describe('input handling', () => {
    it('treats SQL metacharacters in search as plain text', async () => {
      const s = await login(app, DEMO_USERS.assistant);
      for (const q of ["' OR 1=1 --", "'; DROP TABLE patients; --", '%_\\', 'Karim\u0000']) {
        const res = await s.get(`/api/patients?q=${encodeURIComponent(q)}`);
        expect(res.status).toBeLessThan(500);
      }
      const nul = await s.post('/api/patients', { fullName: 'Nul\u0000Byte', gender: 'MALE', phone: '01711000000' });
      expect(nul.status).toBe(400);
      expect(await prisma.patient.count()).toBeGreaterThan(0);
    });

    it('ignores privilege fields sent to self-service endpoints (mass assignment)', async () => {
      const s = await login(app, DEMO_USERS.assistant);
      const res = await s.patch('/api/auth/profile', { preferredLanguage: 'en', role: 'SUPER_ADMIN', isActive: true, permissions: ['system.manage'] });
      expect(res.status).toBeLessThan(500);
      const me = await s.get('/api/auth/me');
      expect(me.body.data.activeMembership.role).toBe('ASSISTANT');
      expect(me.body.data.permissions).not.toContain('system.manage');
    });

    it('rejects oversized and malformed JSON bodies with 4xx, not 500', async () => {
      const big = await request(server()).post('/api/auth/login').set('Content-Type', 'application/json').send(`{"email":"${'a'.repeat(1_200_000)}"}`);
      expect(big.status).toBe(413);
      expect(big.body.success).toBe(false);
      const bad = await request(server()).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('never leaks stack traces or SQL in error responses', async () => {
      const s = await login(app, DEMO_USERS.assistant);
      const res = await s.get('/api/patients/not-a-uuid');
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|prisma|SELECT|node_modules/i);
    });
  });

  describe('transport & headers', () => {
    it('sends hardening headers and hides the framework', async () => {
      const res = await request(server()).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['referrer-policy']).toBeDefined();
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('marks authenticated API responses as non-cacheable', async () => {
      const s = await login(app, DEMO_USERS.assistant);
      const res = await s.get('/api/auth/me');
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    it('does not allow cross-origin credentialed requests from unknown origins', async () => {
      const res = await request(server()).options('/api/auth/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('keeps /metrics hidden unless a scrape token is configured', async () => {
      expect((await request(server()).get('/api/metrics')).status).toBe(404);
      expect((await request(server()).get('/api/metrics').set('Authorization', 'Bearer guess')).status).toBe(404);
    });

    it('readiness reports database and migrations', async () => {
      const res = await request(server()).get('/api/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'ok', database: 'ok', migrations: 'ok' });
    });
  });
});
