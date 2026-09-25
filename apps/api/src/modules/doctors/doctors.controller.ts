import { Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DoctorSelfProfileInput, doctorSelfProfileSchema, DoctorFeesInput, doctorFeesSchema, DoctorScheduleInput, doctorScheduleSchema, PERMISSIONS } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { DoctorsService } from './doctors.service';

@ApiTags('doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  list(@CurrentActor() actor: Actor) {
    return this.doctors.list(actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.doctors.get(actor, id);
  }

  @Put(':id/schedule')
  @RequirePermissions(PERMISSIONS.SCHEDULES_MANAGE)
  updateSchedule(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(doctorScheduleSchema) body: DoctorScheduleInput) {
    return this.doctors.updateSchedule(actor, id, body);
  }

  @Put(':id/fees')
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  updateFees(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(doctorFeesSchema) body: DoctorFeesInput) {
    return this.doctors.updateFees(actor, id, body);
  }

  @Get(':id/profile')
  @RequirePermissions(PERMISSIONS.CHAMBERS_VIEW)
  getProfile(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.doctors.getProfile(actor, id);
  }

  /** Own profile (doctors) or any doctor of the chamber (users.update) — checked in the service. */
  @Put(':id/profile')
  @RequirePermissions(PERMISSIONS.CHAMBERS_VIEW)
  updateProfile(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(doctorSelfProfileSchema) body: DoctorSelfProfileInput) {
    return this.doctors.updateProfile(actor, id, body);
  }
}
