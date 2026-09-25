import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AllergyInput,
  allergyInputSchema,
  CreatePatientInput,
  createPatientSchema,
  DeleteWithReasonInput,
  deleteWithReasonSchema,
  DuplicateCheckInput,
  duplicateCheckSchema,
  PatientListQuery,
  patientListQuerySchema,
  patientSearchQuerySchema,
  PERMISSIONS,
  timelineQuerySchema,
  UpdateMedicalHistoryInput,
  updateMedicalHistorySchema,
  UpdatePatientInput,
  updatePatientSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { PatientsService } from './patients.service';
import { PatientTimelineService } from './patient-timeline.service';


@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly timeline: PatientTimelineService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PATIENTS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(patientListQuerySchema) query: PatientListQuery) {
    return this.patients.list(actor, query);
  }

  @Get('search')
  @RequirePermissions(PERMISSIONS.PATIENTS_VIEW)
  search(@CurrentActor() actor: Actor, @ValidQuery(patientSearchQuerySchema) query: z.infer<typeof patientSearchQuerySchema>) {
    return this.patients.quickSearch(actor, query.q, query.limit);
  }

  @Get('recent')
  @RequirePermissions(PERMISSIONS.PATIENTS_VIEW)
  recent(@CurrentActor() actor: Actor) {
    return this.patients.recent(actor);
  }

  @Post('duplicates')
  @RequirePermissions(PERMISSIONS.PATIENTS_CREATE)
  duplicates(@CurrentActor() actor: Actor, @ValidBody(duplicateCheckSchema) body: DuplicateCheckInput) {
    return this.patients.checkDuplicates(actor, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PATIENTS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(actor, id);
  }

  @Get(':id/timeline')
  @RequirePermissions(PERMISSIONS.PATIENTS_VIEW)
  async getTimeline(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidQuery(timelineQuerySchema) query: z.infer<typeof timelineQuerySchema>,
  ) {
    const patient = await this.patients.load(actor, id);
    return this.timeline.timeline(actor, patient, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PATIENTS_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(createPatientSchema) body: CreatePatientInput) {
    return this.patients.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PATIENTS_UPDATE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(updatePatientSchema) body: UpdatePatientInput) {
    return this.patients.update(actor, id, body);
  }

  @Put(':id/medical-history')
  @RequirePermissions(PERMISSIONS.PATIENTS_UPDATE_MEDICAL, PERMISSIONS.PATIENTS_VIEW_MEDICAL)
  updateMedical(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ValidBody(updateMedicalHistorySchema) body: UpdateMedicalHistoryInput,
  ) {
    return this.patients.updateMedicalHistory(actor, id, body);
  }

  @Post(':id/allergies')
  @RequirePermissions(PERMISSIONS.PATIENTS_UPDATE_MEDICAL, PERMISSIONS.PATIENTS_VIEW_MEDICAL)
  addAllergy(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(allergyInputSchema) body: AllergyInput) {
    return this.patients.addAllergy(actor, id, body);
  }

  @Delete(':id/allergies/:allergyId')
  @RequirePermissions(PERMISSIONS.PATIENTS_UPDATE_MEDICAL, PERMISSIONS.PATIENTS_VIEW_MEDICAL)
  removeAllergy(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allergyId', ParseUUIDPipe) allergyId: string,
    @ValidBody(deleteWithReasonSchema) body: DeleteWithReasonInput,
  ) {
    return this.patients.removeAllergy(actor, id, allergyId, body.reason);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PATIENTS_DELETE)
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(deleteWithReasonSchema) body: DeleteWithReasonInput) {
    await this.patients.remove(actor, id, body.reason);
    return { deleted: true };
  }
}
