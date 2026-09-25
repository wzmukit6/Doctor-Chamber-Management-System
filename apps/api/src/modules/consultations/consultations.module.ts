import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PatientsModule } from '../patients/patients.module';
import { ConsultationsController, PreConsultationVitalsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ConsultationTimelineProvider } from './consultation-timeline.provider';

@Module({
  imports: [AppointmentsModule, PatientsModule],
  controllers: [ConsultationsController, PreConsultationVitalsController],
  providers: [ConsultationsService, ConsultationTimelineProvider],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
