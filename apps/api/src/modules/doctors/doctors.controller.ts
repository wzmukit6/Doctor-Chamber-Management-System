import { Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DoctorScheduleInput, doctorScheduleSchema, PERMISSIONS } from '@chamber/shared';
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
}
