import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { DEMO_PASSWORD, DEMO_USERS } from '../prisma/seed-lib';
import { InMemoryEmailProvider } from '../src/modules/notifications/providers';
import { createTestApp, login, STRONG_PASSWORD, uniqueEmail } from './helpers';

describe('Authentication (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let chamberAId: string;

  beforeAll(async () => {
    app = await createTestApp();
    chamberAId = (await prisma.chamber.findFirstOrThrow({ where: { code: 'DHN' } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createAssistant(password = STRONG_PASSWORD) {
    const admin = await login(app, DEMO_USERS.superAdmin);
    const email = uniqueEmail('assistant');
    const res = await admin.post('/api/users', {
      fullName: 'Test Assistant',
      email,
      password,
      role: 'ASSISTANT',
      chamberId: chamberAId,
    });
    expect(res.status).toBe(201);
    return { email, id: res.body.data.id as string };
  }

  it('logs in, sets secure cookies and returns the current user with server-resolved permissions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: DEMO_USERS.doctor, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('ca_session='))).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('ca_csrf='))).not.toMatch(/HttpOnly/i);

    const s = await login(app, DEMO_USERS.doctor);
    const me = await s.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.activeMembership.role).toBe('DOCTOR');
    expect(me.body.data.permissions).toContain('prescriptions.finalize');
    expect(me.body.data.permissions).not.toContain('users.create');
    expect(me.body.data.doctorId).toBeTruthy();
  });

  it('rejects bad credentials with the same error for unknown and known emails', async () => {
    const server = app.getHttpServer();
    const wrong = await request(server).post('/api/auth/login').send({ email: DEMO_USERS.manager, password: 'nope' });
    const unknown = await request(server)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.chamber.local', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('returns structured validation errors', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('locks the account after repeated failed attempts (brute-force protection)', async () => {
    const { email } = await createAssistant();
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i++) {
      await request(server).post('/api/auth/login').send({ email, password: 'Wrong-password-1' });
    }
    const locked = await request(server).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('requires the CSRF token on state-changing requests', async () => {
    const s = await login(app, DEMO_USERS.doctor);
    const noToken = await s.agent.post('/api/auth/logout').send({});
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const badToken = await s.agent.post('/api/auth/logout').set('X-CSRF-Token', 'x'.repeat(43)).send({});
    expect(badToken.status).toBe(403);
    const ok = await s.post('/api/auth/logout');
    expect(ok.status).toBe(200);
  });

  it('rejects non-JSON request bodies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('email=a@b.com&password=x');
    expect(res.status).toBe(415);
  });

  it('logout revokes the session server-side', async () => {
    const s = await login(app, DEMO_USERS.assistant);
    expect((await s.get('/api/auth/me')).status).toBe(200);
    await s.post('/api/auth/logout');
    const after = await s.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects requests without a session', async () => {
    const res = await request(app.getHttpServer()).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('change password verifies the current password and signs out other sessions', async () => {
    const { email } = await createAssistant();
    const first = await login(app, email, STRONG_PASSWORD);
    const second = await login(app, email, STRONG_PASSWORD);

    const wrong = await second.post('/api/auth/change-password', {
      currentPassword: 'Incorrect-1a',
      newPassword: 'An0therStrongPass',
    });
    expect(wrong.status).toBe(422);

    const weak = await second.post('/api/auth/change-password', { currentPassword: STRONG_PASSWORD, newPassword: 'weak' });
    expect(weak.status).toBe(422);

    const ok = await second.post('/api/auth/change-password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'An0therStrongPass',
    });
    expect(ok.status).toBe(200);
    expect((await first.get('/api/auth/me')).status).toBe(401);
    expect((await second.get('/api/auth/me')).status).toBe(200);
  });

  it('forgot/reset password: generic response, single-use token, sessions revoked', async () => {
    const { email } = await createAssistant();
    const existing = await login(app, email, STRONG_PASSWORD);
    const server = app.getHttpServer();

    const unknown = await request(server).post('/api/auth/forgot-password').send({ email: 'ghost@test.chamber.local' });
    const known = await request(server).post('/api/auth/forgot-password').send({ email });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const mail = [...InMemoryEmailProvider.outbox].reverse().find((m) => m.to === email);
    expect(mail).toBeDefined();
    const token = new URL(mail!.data!.link).searchParams.get('token')!;

    const reset = await request(server).post('/api/auth/reset-password').send({ token, newPassword: 'Br4ndNewPassword' });
    expect(reset.status).toBe(200);
    const reuse = await request(server).post('/api/auth/reset-password').send({ token, newPassword: 'Br4ndNewPassword2' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_TOKEN');

    expect((await existing.get('/api/auth/me')).status).toBe(401);
    await expect(login(app, email, 'Br4ndNewPassword')).resolves.toBeDefined();
  });

  it('lets a user update their own profile and lists their sessions', async () => {
    const s = await login(app, DEMO_USERS.doctor);
    const res = await s.patch('/api/auth/profile', { preferredLanguage: 'bn' });
    expect(res.status).toBe(200);
    expect(res.body.data.preferredLanguage).toBe('bn');
    await s.patch('/api/auth/profile', { preferredLanguage: 'en' });
    const sessions = await s.get('/api/auth/sessions');
    expect(sessions.body.data.some((x: { current: boolean }) => x.current)).toBe(true);
  });
});
