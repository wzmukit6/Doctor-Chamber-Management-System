import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './medicines.service';
import { PrescriptionsController, PublicPrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionTimelineProvider } from './prescription-timeline.provider';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [PatientsModule],
  controllers: [MedicinesController, PrescriptionsController, PublicPrescriptionsController, TemplatesController],
  providers: [MedicinesService, PrescriptionsService, TemplatesService, PrescriptionTimelineProvider],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
