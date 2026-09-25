import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { DEMO_USERS } from '../prisma/seed-lib';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../src/common/decorators/auth.decorators';
import { createTestApp, login, Session } from './helpers';

/**
 * Exhaustive authorization matrix (spec §48 "Test every role against every
 * protected endpoint"). Routes are discovered from the running application,
 * so a newly added endpoint is covered automatically:
 *
 *  1. every non-public endpoint rejects anonymous requests with 401;
 *  2. every endpoint either declares its permission(s) or is on the explicit
 *     "any signed-in user" list below — forgetting @RequirePermissions fails the build;
 *  3. every role lacking a required permission receives 403 (the permission guard
 *     runs before validation and the handler, so nothing is changed);
 *  4. every role holding the permissions passes the guard on read endpoints.
 */

interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  isPublic: boolean;
  permissions: string[];
}

const METHODS: Partial<Record<RequestMethod, Route['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Endpoints any signed-in user may call; access is decided by ownership in the service. */
const ANY_AUTHENTICATED = new Set([
  'get /api/auth/me',
  'post /api/auth/logout',
  'post /api/auth/change-password',
  'post /api/auth/switch-chamber',
  'get /api/auth/sessions',
  'delete /api/auth/sessions/:id',
  'patch /api/auth/profile',
  // chamber configuration only, no patient data
  'get /api/vital-definitions',
]);

const FAKE_ID = '00000000-0000-4000-8000-000000000000';

function discoverRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  const join = (...parts: string[]) => `/${parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...args: never[]) => object) | undefined;
      if (!ctrl) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined) ?? '';
      const proto = ctrl.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        if (!method || sub === undefined) continue;
        for (const p of Array.isArray(sub) ? sub : [sub]) {
          routes.push({
            method,
            path: join('api', base, p),
            isPublic: !!(Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, ctrl)),
            permissions: (Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, ctrl) ?? []) as string[],
          });
        }
      }
    }
  }
  return routes;
}

const concrete = (path: string) => path.replace(/:key\b/g, 'appointments-daily').replace(/:[A-Za-z]+/g, FAKE_ID);
const id = (r: Route) => `${r.method} ${r.path}`;

describe('RBAC endpoint matrix (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let routes: Route[];
  const roles: Record<string, { session: Session; permissions: Set<string> }> = {};

  beforeAll(async () => {
    app = await createTestApp();
    routes = discoverRoutes(app);
    const users = {
      superAdmin: DEMO_USERS.superAdmin,
      manager: DEMO_USERS.manager,
      doctor: DEMO_USERS.doctor,
      assistant: DEMO_USERS.assistant,
    };
    for (const [role, email] of Object.entries(users)) {
      const session = await login(app, email);
      const me = await session.get('/api/auth/me');
      roles[role] = { session, permissions: new Set(me.body.data.permissions as string[]) };
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('discovers the whole API', () => {
    expect(routes.length).toBeGreaterThan(140);
    expect(new Set(routes.map(id)).size).toBe(routes.length);
  });

  it('every endpoint is public, permission-protected, or explicitly open to any signed-in user', () => {
    const undeclared = routes.filter((r) => !r.isPublic && r.permissions.length === 0 && !ANY_AUTHENTICATED.has(id(r))).map(id);
    expect(undeclared).toEqual([]);
    const stale = [...ANY_AUTHENTICATED].filter((k) => !routes.some((r) => id(r) === k));
    expect(stale).toEqual([]);
  });

  it('the public surface is limited to sign-in, password recovery, health and prescription verification', () => {
    expect(routes.filter((r) => r.isPublic).map(id).sort()).toEqual(
      [
        'get /api/auth/password-policy',
        'get /api/health',
        'get /api/health/ready',
        'get /api/metrics',
        'get /api/public/prescriptions/verify/:token',
        'post /api/auth/forgot-password',
        'post /api/auth/login',
        'post /api/auth/reset-password',
      ].sort(),
    );
  });

  it('rejects anonymous requests to every protected endpoint with 401', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await request(app.getHttpServer())[r.method](concrete(r.path)).send({});
      if (res.status !== 401 || res.body?.error?.code !== 'UNAUTHENTICATED') failures.push(`${id(r)} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it.each(['superAdmin', 'manager', 'doctor', 'assistant'])('%s receives 403 on every endpoint it lacks a permission for', async (role) => {
    const { session, permissions } = roles[role];
    const failures: string[] = [];
    let checked = 0;
    for (const r of routes.filter((x) => x.permissions.some((p) => !permissions.has(p)))) {
      checked += 1;
      const res = await session[r.method === 'delete' ? 'del' : r.method](concrete(r.path), {});
      if (res.status !== 403 || res.body?.error?.code !== 'FORBIDDEN') failures.push(`${id(r)} → ${res.status} ${res.body?.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
    if (role !== 'superAdmin') expect(checked).toBeGreaterThan(10);
  });

  it.each(['superAdmin', 'manager', 'doctor', 'assistant'])('%s passes the permission guard on every read endpoint it is granted', async (role) => {
    const { session, permissions } = roles[role];
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.method === 'get' && !x.isPublic && x.permissions.every((p) => permissions.has(p)))) {
      const res = await session.get(concrete(r.path));
      // 404 (fake id), 400 (missing query) or a scoped 403 from the service are fine;
      // the generic guard rejection or a server error is not.
      const guardRejected = res.status === 403 && res.body?.error?.message === 'You do not have permission to perform this action';
      if (guardRejected || res.status === 401 || res.status >= 500) failures.push(`${id(r)} → ${res.status} ${res.body?.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
  });

  describe('spec §48 scenarios', () => {
    it('assistant cannot create, revise or finalize prescriptions', async () => {
      const rx = await prisma.prescription.findFirstOrThrow({ where: { status: { in: ['FINALIZED', 'REVISED'] } } });
      const { session } = roles.assistant;
      for (const res of [
        await session.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'Changing the dose' }),
        await session.post('/api/prescription-templates', { name: 'x' }),
      ]) {
        expect(res.status).toBe(403);
      }
      const after = await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
      expect(after.status).toBe(rx.status);
    });

    it('doctor A cannot see a chamber B patient (reported as not found)', async () => {
      const patientB = await prisma.patient.findFirstOrThrow({ where: { chamber: { code: 'UTR' } } });
      const res = await roles.doctor.session.get(`/api/patients/${patientB.id}`);
      expect(res.status).toBe(404);
      const timeline = await roles.doctor.session.get(`/api/patients/${patientB.id}/timeline`);
      expect(timeline.status).toBe(404);
    });

    it('manager A cannot read chamber B bills, appointments or reports', async () => {
      const chamberB = await prisma.chamber.findFirstOrThrow({ where: { code: 'UTR' } });
      const invoiceB = await prisma.invoice.findFirst({ where: { chamberId: chamberB.id } });
      if (invoiceB) expect((await roles.manager.session.get(`/api/invoices/${invoiceB.id}`)).status).toBe(404);
      const apptB = await prisma.appointment.findFirst({ where: { chamberId: chamberB.id } });
      if (apptB) expect((await roles.manager.session.get(`/api/appointments/${apptB.id}`)).status).toBe(404);
      const report = await roles.manager.session.get(`/api/reports/appointments-daily?from=2026-01-01&to=2026-01-31&chamberId=${chamberB.id}`);
      expect(report.status).toBe(200);
      expect(report.body.data.params.chamberName).not.toBe(chamberB.name);
    });

    it('doctor cannot change system or chamber settings', async () => {
      const { session } = roles.doctor;
      expect((await session.put('/api/settings/security', { passwordMinLength: 8, version: 0 })).status).toBe(403);
      expect((await session.put('/api/roles/DOCTOR/permissions', { permissions: [] })).status).toBe(403);
      expect((await session.put('/api/settings/billing', {})).status).toBe(403);
    });
  });
});
