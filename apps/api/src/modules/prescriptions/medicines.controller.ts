import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MedicineInput, MedicineQuery, medicineQuerySchema, medicineSchema, medicineStatusSchema, PERMISSIONS } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { MedicinesService } from './medicines.service';

@ApiTags('medicines')
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MEDICINES_VIEW)
  search(@CurrentActor() actor: Actor, @ValidQuery(medicineQuerySchema) q: MedicineQuery) {
    return this.medicines.search(actor, q);
  }

  @Get('suggestions')
  @RequirePermissions(PERMISSIONS.MEDICINES_VIEW)
  suggestions(@CurrentActor() actor: Actor) {
    return this.medicines.suggestions(actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MEDICINES_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medicines.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MEDICINES_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(medicineSchema) body: MedicineInput) {
    return this.medicines.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MEDICINES_UPDATE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(medicineSchema) body: MedicineInput) {
    return this.medicines.update(actor, id, body);
  }

  /** Reactivating needs `medicines.update`; deactivating additionally `medicines.delete` (checked in the service). */
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.MEDICINES_UPDATE)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(medicineStatusSchema) body: z.infer<typeof medicineStatusSchema>) {
    return this.medicines.setStatus(actor, id, body.isActive);
  }

  @Put(':id/favorite')
  @RequirePermissions(PERMISSIONS.MEDICINES_VIEW, PERMISSIONS.PRESCRIPTIONS_CREATE)
  favorite(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medicines.setFavorite(actor, id, true);
  }

  @Delete(':id/favorite')
  @RequirePermissions(PERMISSIONS.MEDICINES_VIEW, PERMISSIONS.PRESCRIPTIONS_CREATE)
  unfavorite(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.medicines.setFavorite(actor, id, false);
  }
}
