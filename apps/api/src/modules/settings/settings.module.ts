import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { AppointmentSettingsService } from './appointment-settings.service';

@Global()
@Module({ controllers: [SettingsController], providers: [AppointmentSettingsService], exports: [AppointmentSettingsService] })
export class SettingsModule {}
