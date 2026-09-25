import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { AppointmentSettingsService } from './appointment-settings.service';
import { PrescriptionSettingsService } from './prescription-settings.service';
import { BillingSettingsService } from './billing-settings.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [AppointmentSettingsService, PrescriptionSettingsService, BillingSettingsService],
  exports: [AppointmentSettingsService, PrescriptionSettingsService, BillingSettingsService],
})
export class SettingsModule {}
