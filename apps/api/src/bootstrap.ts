import { INestApplication, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadConfig } from './config/config';

/** Shared HTTP configuration for the server and the integration tests. */
export function configureApp(app: INestApplication) {
  const config = loadConfig();
  const express = app as NestExpressApplication;
  if (config.TRUST_PROXY) express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  express.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('Chamber Assistant API')
    .setDescription(
      [
        'REST API for the Chamber Assistant practice & prescription manager.',
        '',
        '**Authentication:** `POST /api/auth/login` sets an HttpOnly `ca_session` cookie and a readable `ca_csrf` cookie.',
        'State-changing requests must echo the CSRF token in the `X-CSRF-Token` header.',
        '',
        '**Authorization:** each endpoint lists the permission(s) it requires (`x-permissions`). Tenant scope',
        '(chamber) and resource ownership are enforced in addition to permissions.',
        '',
        '**Responses:** `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`.',
        'List endpoints accept `page`, `pageSize` (≤100), `q`, `sort`, `order`.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addCookieAuth('ca_session', { type: 'apiKey', in: 'cookie', name: 'ca_session' }, 'session')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  Logger.log('OpenAPI docs available at /api/docs', 'Swagger');
}
