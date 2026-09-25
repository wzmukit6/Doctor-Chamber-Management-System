import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CatalogQuery,
  catalogQuerySchema,
  catalogStatusSchema,
  ComplaintCatalogInput,
  complaintCatalogSchema,
  DiagnosisCatalogInput,
  diagnosisCatalogSchema,
  InvestigationCatalogInput,
  investigationCatalogSchema,
  PERMISSIONS,
  VitalDefinitionInput,
  vitalDefinitionSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { CatalogService } from './catalog.service';
import { VitalDefinitionsService } from './vital-definitions.service';

type Status = z.infer<typeof catalogStatusSchema>;

@ApiTags('catalog')
@Controller('diagnoses')
export class DiagnosesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_VIEW)
  search(@CurrentActor() actor: Actor, @ValidQuery(catalogQuerySchema) q: CatalogQuery) {
    return this.catalog.search(actor, 'diagnoses', q);
  }

  @Get('frequent')
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_VIEW)
  frequent(@CurrentActor() actor: Actor) {
    return this.catalog.frequent(actor, 'diagnoses');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(diagnosisCatalogSchema) body: DiagnosisCatalogInput) {
    return this.catalog.create(actor, 'diagnoses', body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(diagnosisCatalogSchema) body: DiagnosisCatalogInput) {
    return this.catalog.update(actor, 'diagnoses', id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(catalogStatusSchema) body: Status) {
    return this.catalog.setStatus(actor, 'diagnoses', id, body.isActive);
  }
}

@ApiTags('catalog')
@Controller('investigations')
export class InvestigationsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVESTIGATIONS_VIEW)
  search(@CurrentActor() actor: Actor, @ValidQuery(catalogQuerySchema) q: CatalogQuery) {
    return this.catalog.search(actor, 'investigations', q);
  }

  @Get('frequent')
  @RequirePermissions(PERMISSIONS.INVESTIGATIONS_VIEW)
  frequent(@CurrentActor() actor: Actor) {
    return this.catalog.frequent(actor, 'investigations');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVESTIGATIONS_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(investigationCatalogSchema) body: InvestigationCatalogInput) {
    return this.catalog.create(actor, 'investigations', body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.INVESTIGATIONS_MANAGE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(investigationCatalogSchema) body: InvestigationCatalogInput) {
    return this.catalog.update(actor, 'investigations', id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVESTIGATIONS_MANAGE)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(catalogStatusSchema) body: Status) {
    return this.catalog.setStatus(actor, 'investigations', id, body.isActive);
  }
}

/** Predefined chief complaints; managed together with the diagnosis master data. */
@ApiTags('catalog')
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_VIEW)
  search(@CurrentActor() actor: Actor, @ValidQuery(catalogQuerySchema) q: CatalogQuery) {
    return this.catalog.search(actor, 'complaints', q);
  }

  @Get('frequent')
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_VIEW)
  frequent(@CurrentActor() actor: Actor) {
    return this.catalog.frequent(actor, 'complaints');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(complaintCatalogSchema) body: ComplaintCatalogInput) {
    return this.catalog.create(actor, 'complaints', body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(complaintCatalogSchema) body: ComplaintCatalogInput) {
    return this.catalog.update(actor, 'complaints', id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DIAGNOSIS_MANAGE)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(catalogStatusSchema) body: Status) {
    return this.catalog.setStatus(actor, 'complaints', id, body.isActive);
  }
}

const vitalCreateSchema = vitalDefinitionSchema.and(z.object({ global: z.boolean().default(false) }));
const vitalUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  unit: z.string().trim().max(20).nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
  decimals: z.number().int().min(0).max(3).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

@ApiTags('catalog')
@Controller('vital-definitions')
export class VitalDefinitionsController {
  constructor(private readonly vitals: VitalDefinitionsService) {}

  /** Configuration only (no patient data) — readable by any signed-in user. */
  @Get()
  list(@CurrentActor() actor: Actor, @Query('includeInactive') includeInactive?: string) {
    return this.vitals.list(actor, includeInactive === 'true');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@CurrentActor() actor: Actor, @ValidBody(vitalCreateSchema) body: VitalDefinitionInput & { global: boolean }) {
    return this.vitals.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(vitalUpdateSchema) body: z.infer<typeof vitalUpdateSchema>) {
    return this.vitals.update(actor, id, body);
  }
}
