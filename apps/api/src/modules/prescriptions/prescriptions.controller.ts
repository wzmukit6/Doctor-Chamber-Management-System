import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  PERMISSIONS,
  PrescriptionListQuery,
  prescriptionListQuerySchema,
  prescriptionVersionActionSchema,
  printPrescriptionSchema,
  SavePrescriptionDraftInput,
  savePrescriptionDraftSchema,
  startRevisionSchema,
  uuidSchema,
} from '@chamber/shared';
import { CurrentActor, Public, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { PrescriptionsService } from './prescriptions.service';

const latestQuerySchema = z.object({ patientId: uuidSchema, excludeConsultationId: uuidSchema.optional() });
const printQuerySchema = z.object({ version: z.coerce.number().int().min(1).optional() });
type VersionBody = z.infer<typeof prescriptionVersionActionSchema>;

@ApiTags('prescriptions')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(prescriptionListQuerySchema) q: PrescriptionListQuery) {
    return this.prescriptions.list(actor, q);
  }

  /** The patient's most recent issued prescription, for "copy previous prescription". */
  @Get('latest')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  latest(@CurrentActor() actor: Actor, @ValidQuery(latestQuerySchema) q: z.infer<typeof latestQuerySchema>) {
    return this.prescriptions.latestForPatient(actor, q.patientId, q.excludeConsultationId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.prescriptions.get(actor, id);
  }

  @Get(':id/print')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_PRINT)
  printData(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidQuery(printQuerySchema) q: z.infer<typeof printQuerySchema>) {
    return this.prescriptions.printData(actor, id, q.version);
  }

  @Post(':id/print-log')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_PRINT)
  logPrint(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(printPrescriptionSchema) body: z.infer<typeof printPrescriptionSchema>) {
    return this.prescriptions.logPrint(actor, id, body.versionNumber);
  }

  @Post(':id/revisions')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_REVISE)
  revise(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(startRevisionSchema) body: z.infer<typeof startRevisionSchema>) {
    return this.prescriptions.startRevision(actor, id, body.reason, body.version);
  }

  @Put(':id/draft')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_UPDATE)
  saveDraft(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(savePrescriptionDraftSchema) body: SavePrescriptionDraftInput) {
    return this.prescriptions.saveDraft(actor, id, body);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_FINALIZE)
  finalize(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(prescriptionVersionActionSchema) body: VersionBody) {
    return this.prescriptions.finalizeRevision(actor, id, body.version);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_REVISE)
  discard(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(prescriptionVersionActionSchema) body: VersionBody) {
    return this.prescriptions.discardRevision(actor, id, body.version);
  }
}

/** Public verification endpoint behind the QR code (spec §14) — no session, no patient data. */
@ApiTags('public')
@Controller('public/prescriptions')
export class PublicPrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Get('verify/:token')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Param('token') token: string) {
    return this.prescriptions.verify(token.slice(0, 64));
  }
}
