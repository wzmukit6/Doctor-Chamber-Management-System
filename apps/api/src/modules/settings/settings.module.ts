import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { AppointmentSettingsService } from './appointment-settings.service';
import { PrescriptionSettingsService } from './prescription-settings.service';
import { BillingSettingsService } from './billing-settings.service';
import { ChamberProfileService } from './chamber-profile.service';
import { SecuritySettingsService } from './security-settings.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [AppointmentSettingsService, PrescriptionSettingsService, BillingSettingsService, ChamberProfileService, SecuritySettingsService],
  exports: [AppointmentSettingsService, PrescriptionSettingsService, BillingSettingsService, ChamberProfileService, SecuritySettingsService],
})
export class SettingsModule {}
