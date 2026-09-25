import { Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  UpdateAppointmentSettingsInput,
  updateAppointmentSettingsSchema,
  UpdatePrescriptionSettingsInput,
  updatePrescriptionSettingsSchema,
  UpdateBillingSettingsInput,
  updateBillingSettingsSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody } from '../../common/decorators/validated.decorator';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';
import { AppointmentSettingsService } from './appointment-settings.service';
import { PrescriptionSettingsService } from './prescription-settings.service';
import { BillingSettingsService } from './billing-settings.service';

function chamberOf(actor: Actor): string {
  if (!actor.chamberId) throw AppError.forbidden('Chamber settings require a chamber membership');
  return actor.chamberId;
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly appointments: AppointmentSettingsService,
    private readonly prescriptions: PrescriptionSettingsService,
    private readonly billing: BillingSettingsService,
  ) {}

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

  /** Readable by everyone who writes or prints prescriptions. */
  @Get('prescriptions')
  @RequirePermissions(PERMISSIONS.PRESCRIPTIONS_VIEW)
  getPrescriptions(@CurrentActor() actor: Actor) {
    return this.prescriptions.get(chamberOf(actor));
  }

  @Put('prescriptions')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updatePrescriptions(@CurrentActor() actor: Actor, @ValidBody(updatePrescriptionSettingsSchema) body: UpdatePrescriptionSettingsInput) {
    return this.prescriptions.update(actor, chamberOf(actor), body);
  }

  @Get('billing')
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  getBilling(@CurrentActor() actor: Actor) {
    return this.billing.get(chamberOf(actor));
  }

  @Put('billing')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateBilling(@CurrentActor() actor: Actor, @ValidBody(updateBillingSettingsSchema) body: UpdateBillingSettingsInput) {
    return this.billing.update(actor, chamberOf(actor), body);
  }
}
