import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { AppointmentSettingsService } from './appointment-settings.service';
import { PrescriptionSettingsService } from './prescription-settings.service';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [AppointmentSettingsService, PrescriptionSettingsService],
  exports: [AppointmentSettingsService, PrescriptionSettingsService],
})
export class SettingsModule {}
