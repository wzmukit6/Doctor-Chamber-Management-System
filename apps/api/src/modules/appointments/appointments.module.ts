import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { AppointmentsController, QueueController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { QueueService } from './queue.service';
import { AppointmentTimelineProvider } from './appointment-timeline.provider';

@Module({
  imports: [PatientsModule],
  controllers: [AppointmentsController, QueueController],
  providers: [AppointmentsService, QueueService, AppointmentTimelineProvider],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
