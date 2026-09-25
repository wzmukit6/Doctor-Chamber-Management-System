import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { FeeItemsController, InvoicesController } from './billing.controller';
import { FeesService } from './fees.service';
import { InvoicesService } from './invoices.service';
import { PaymentTimelineProvider } from './payment-timeline.provider';

@Module({
  imports: [PatientsModule],
  controllers: [InvoicesController, FeeItemsController],
  providers: [InvoicesService, FeesService, PaymentTimelineProvider],
})
export class BillingModule {}
