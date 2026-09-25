import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, UpdateAppointmentSettingsInput, updateAppointmentSettingsSchema } from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';
import { AppointmentSettingsService } from './appointment-settings.service';

function chamberOf(actor: Actor): string {
  if (!actor.chamberId) throw AppError.forbidden('Chamber settings require a chamber membership');
  return actor.chamberId;
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly appointments: AppointmentSettingsService) {}

  /** Readable by everyone who books appointments (slot length, token format). */
  @Get('appointments')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  getAppointments(@CurrentActor() actor: Actor) {
    return this.appointments.get(chamberOf(actor));
  }

  @Put('appointments')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateAppointments(@CurrentActor() actor: Actor, @ValidBody(updateAppointmentSettingsSchema) body: UpdateAppointmentSettingsInput) {
    return this.appointments.update(actor, chamberOf(actor), body);
  }
}
