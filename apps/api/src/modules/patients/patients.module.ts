import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientsRepository } from './patients.repository';
import { PatientTimelineService } from './patient-timeline.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, PatientTimelineService],
  exports: [PatientsService, PatientTimelineService],
})
export class PatientsModule {}
