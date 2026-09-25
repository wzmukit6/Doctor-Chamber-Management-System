import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SystemController } from './system.controller';

@Module({ controllers: [HealthController, SystemController] })
export class HealthModule {}
