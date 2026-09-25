import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  BillingSummaryQuery,
  billingSummaryQuerySchema,
  CreateInvoiceInput,
  createInvoiceSchema,
  FeeItemInput,
  feeItemSchema,
  feeItemStatusSchema,
  InvoiceListQuery,
  invoiceListQuerySchema,
  PERMISSIONS,
  RecordPaymentInput,
  recordPaymentSchema,
  RefundInput,
  refundSchema,
  UpdateInvoiceInput,
  updateInvoiceSchema,
  uuidSchema,
  voidInvoiceSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { FeesService } from './fees.service';
import { InvoicesService } from './invoices.service';

const suggestQuerySchema = z.object({ appointmentId: uuidSchema.optional(), patientId: uuidSchema.optional() });

@ApiTags('billing')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(invoiceListQuerySchema) q: InvoiceListQuery) {
    return this.invoices.list(actor, q);
  }

  /** Pre-filled bill for a visit (doctor fee by visit type + ordered investigations with a chamber fee). */
  @Get('suggest')
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  suggest(@CurrentActor() actor: Actor, @ValidQuery(suggestQuerySchema) q: z.infer<typeof suggestQuerySchema>) {
    return this.invoices.suggest(actor, q);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  summary(@CurrentActor() actor: Actor, @ValidQuery(billingSummaryQuerySchema) q: BillingSummaryQuery) {
    return this.invoices.summary(actor, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(actor, id);
  }

  @Get(':id/print')
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  printData(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.printData(actor, id);
  }

  @Post(':id/print-log')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  logPrint(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.logPrint(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(createInvoiceSchema) body: CreateInvoiceInput) {
    return this.invoices.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(updateInvoiceSchema) body: UpdateInvoiceInput) {
    return this.invoices.update(actor, id, body);
  }

  @Post(':id/payments')
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  pay(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(recordPaymentSchema) body: RecordPaymentInput) {
    return this.invoices.recordPayment(actor, id, body);
  }

  @Post(':id/refunds')
  @RequirePermissions(PERMISSIONS.BILLING_REFUND)
  refund(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(refundSchema) body: RefundInput) {
    return this.invoices.refund(actor, id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  void(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(voidInvoiceSchema) body: z.infer<typeof voidInvoiceSchema>) {
    return this.invoices.void(actor, id, body.reason, body.version);
  }
}

@ApiTags('billing')
@Controller('fee-items')
export class FeeItemsController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  list(@CurrentActor() actor: Actor, @Query('includeInactive') includeInactive?: string) {
    return this.fees.list(actor, includeInactive === 'true');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  create(@CurrentActor() actor: Actor, @ValidBody(feeItemSchema) body: FeeItemInput) {
    return this.fees.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(feeItemSchema) body: FeeItemInput) {
    return this.fees.update(actor, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_UPDATE)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(feeItemStatusSchema) body: z.infer<typeof feeItemStatusSchema>) {
    return this.fees.setStatus(actor, id, body.isActive);
  }
}
