import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../request-context';
import { metrics } from './metrics';
import { logEvent } from './log-event';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Route pattern (`/api/patients/:id`) — never the concrete URL or its query string. */
export function routePattern(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (typeof route === 'string') return `${req.baseUrl ?? ''}${route}`;
  return req.path.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 120);
}

/**
 * Access log + request id + latency metrics (spec §64). One structured line per
 * request with method, route pattern, status, duration, user and chamber ids.
 * Bodies and query strings are never logged: they can contain patient data.
 * 401/403/429 responses are logged as security events.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const route = routePattern(req);
      metrics.recordRequest(req.method, route, res.statusCode, durationMs);
      if (route.startsWith('/api/health') || route === '/api/metrics') return;
      const actor = (req as AuthenticatedRequest).actor;
      const entry = {
        requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: actor?.userId,
        chamberId: actor?.chamberId ?? undefined,
        ip: req.ip,
      };
      const security = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429;
      if (res.statusCode >= 500) logEvent(this.logger, 'error', { event: 'http.error', ...entry });
      else if (process.env.NODE_ENV === 'test') return;
      else if (security) logEvent(this.logger, 'warn', { event: `security.http_${res.statusCode}`, ...entry });
      else logEvent(this.logger, 'log', { event: 'http.request', ...entry });
    });
    next();
  }
}
