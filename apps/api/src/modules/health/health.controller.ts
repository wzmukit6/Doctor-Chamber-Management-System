import { Controller, Get, Headers, HttpCode, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { loadConfig } from '../../config/config';
import { metrics } from '../../common/observability/metrics';

/**
 * Liveness (`/health`, process only), readiness (`/health/ready`, database and
 * migrations) and Prometheus metrics (`/metrics`, bearer token; disabled unless
 * METRICS_TOKEN is set). None of them expose data or configuration.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000), version: loadConfig().APP_VERSION, time: new Date().toISOString() };
  }

  @Public()
  @SkipThrottle()
  @Get('health/ready')
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [failed] = await this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      if (failed.n > 0) {
        res.status(503);
        return { status: 'unavailable', database: 'ok', migrations: 'failed' };
      }
      return { status: 'ok', database: 'ok', migrations: 'ok', dbLatencyMs: Date.now() - started };
    } catch {
      res.status(503);
      return { status: 'unavailable', database: 'unreachable' };
    }
  }

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Get('metrics')
  metrics(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = loadConfig().METRICS_TOKEN;
    const given = Buffer.from(auth?.replace(/^Bearer /, '') ?? '');
    if (!token || given.length !== Buffer.byteLength(token) || !timingSafeEqual(given, Buffer.from(token))) {
      throw AppError.notFound('Resource');
    }
    res.type('text/plain; version=0.0.4').send(metrics.prometheus());
  }
}
