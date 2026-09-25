import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadConfig } from '../config/config';
import { metrics } from '../common/observability/metrics';
import { logEvent } from '../common/observability/log-event';

@Injectable()
export class PrismaService extends PrismaClient<Prisma.PrismaClientOptions, 'query'> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Database');

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    const slowMs = loadConfig().SLOW_QUERY_MS;
    // Database monitoring (spec §64): latency histogram + slow-query log.
    // Only the SQL text is logged — parameter values can contain patient data.
    this.$on('query', (e: Prisma.QueryEvent) => {
      const slow = e.duration >= slowMs;
      metrics.recordQuery(e.duration, slow);
      if (slow) logEvent(this.logger, 'warn', { event: 'db.slow_query', durationMs: e.duration, query: e.query.slice(0, 600) });
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
