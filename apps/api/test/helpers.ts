import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DEMO_PASSWORD } from '../prisma/seed-lib';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  /** Request helpers that attach the CSRF header automatically. */
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string, body?: object) => request.Test;
}

export async function login(app: INestApplication, email: string, password = DEMO_PASSWORD): Promise<Session> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.data.csrfToken;
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: (url, body) => agent.post(url).set('X-CSRF-Token', csrf).send(body ?? {}),
    patch: (url, body) => agent.patch(url).set('X-CSRF-Token', csrf).send(body ?? {}),
    put: (url, body) => agent.put(url).set('X-CSRF-Token', csrf).send(body ?? {}),
    del: (url, body) => agent.delete(url).set('X-CSRF-Token', csrf).send(body ?? {}),
  };
}

let counter = 0;
export function uniqueEmail(prefix: string) {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@test.chamber.local`;
}

export const STRONG_PASSWORD = 'Str0ngPassw0rd';
