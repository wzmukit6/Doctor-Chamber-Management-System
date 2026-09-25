import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addendumSchema,
  cancelConsultationSchema,
  ConsultationListQuery,
  consultationListQuerySchema,
  finalizeConsultationSchema,
  PERMISSIONS,
  RecordVitalsInput,
  recordVitalsSchema,
  SaveConsultationInput,
  saveConsultationSchema,
  StartConsultationInput,
  startConsultationSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { ConsultationsService } from './consultations.service';

const followUpQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  doctorId: z.string().uuid().optional(),
});

@ApiTags('consultations')
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(consultationListQuerySchema) q: ConsultationListQuery) {
    return this.consultations.list(actor, q);
  }

  @Get('follow-ups')
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_VIEW)
  followUps(@CurrentActor() actor: Actor, @ValidQuery(followUpQuerySchema) q: z.infer<typeof followUpQuerySchema>) {
    return this.consultations.followUps(actor, q.from, q.to, q.doctorId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_CREATE)
  start(@CurrentActor() actor: Actor, @ValidBody(startConsultationSchema) body: StartConsultationInput) {
    return this.consultations.start(actor, body);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_UPDATE)
  save(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(saveConsultationSchema) body: SaveConsultationInput) {
    return this.consultations.save(actor, id, body);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_FINALIZE)
  finalize(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(finalizeConsultationSchema) body: z.infer<typeof finalizeConsultationSchema>) {
    return this.consultations.finalize(actor, id, body.version);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_UPDATE)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(cancelConsultationSchema) body: z.infer<typeof cancelConsultationSchema>) {
    return this.consultations.cancel(actor, id, body.reason, body.version);
  }

  @Post(':id/addenda')
  @RequirePermissions(PERMISSIONS.CONSULTATIONS_UPDATE)
  addendum(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(addendumSchema) body: z.infer<typeof addendumSchema>) {
    return this.consultations.addAddendum(actor, id, body.text);
  }
}

/** Vitals recorded at the front desk before the doctor sees the patient. */
@ApiTags('consultations')
@Controller('appointments')
export class PreConsultationVitalsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Get(':id/vitals')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.preVitals(actor, id);
  }

  @Put(':id/vitals')
  @RequirePermissions(PERMISSIONS.VITALS_RECORD)
  record(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(recordVitalsSchema) body: RecordVitalsInput) {
    return this.consultations.recordPreVitals(actor, id, body);
  }
}
