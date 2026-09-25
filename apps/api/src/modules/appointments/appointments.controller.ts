import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  APPOINTMENT_ACTIONS,
  AppointmentAction,
  appointmentActionSchema,
  AppointmentListQuery,
  appointmentListQuerySchema,
  availabilityQuerySchema,
  callNextSchema,
  CreateAppointmentInput,
  createAppointmentSchema,
  ERROR_CODES,
  PERMISSIONS,
  queueQuerySchema,
  RescheduleAppointmentInput,
  rescheduleAppointmentSchema,
  UpdateAppointmentDetailsInput,
  updateAppointmentDetailsSchema,
} from '@chamber/shared';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidBody, ValidQuery } from '../../common/decorators/validated.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';
import { AppointmentsService } from './appointments.service';
import { QueueService } from './queue.service';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  list(@CurrentActor() actor: Actor, @ValidQuery(appointmentListQuerySchema) query: AppointmentListQuery) {
    return this.appointments.list(actor, query);
  }

  @Get('availability')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  availability(@CurrentActor() actor: Actor, @ValidQuery(availabilityQuerySchema) q: z.infer<typeof availabilityQuerySchema>) {
    return this.appointments.availability(actor, q.doctorId, q.date, q.excludeAppointmentId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_CREATE)
  create(@CurrentActor() actor: Actor, @ValidBody(createAppointmentSchema) body: CreateAppointmentInput) {
    return this.appointments.create(actor, body);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_UPDATE)
  reschedule(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(rescheduleAppointmentSchema) body: RescheduleAppointmentInput) {
    return this.appointments.reschedule(actor, id, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_UPDATE)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ValidBody(updateAppointmentDetailsSchema) body: UpdateAppointmentDetailsInput) {
    return this.appointments.updateDetails(actor, id, body);
  }

  /**
   * Status actions: confirm, check-in, send-to-queue, start, complete,
   * return-to-queue, cancel (reason required), no-show. Each action checks its
   * own permission (see AppointmentsService) in addition to appointments.view.
   */
  @Post(':id/actions/:action')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.APPOINTMENTS_VIEW)
  @ApiBody({ schema: z.toJSONSchema(appointmentActionSchema, { io: 'input', unrepresentable: 'any' }) as never })
  act(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body(new ZodValidationPipe(appointmentActionSchema)) body: z.infer<typeof appointmentActionSchema>,
  ) {
    if (!(APPOINTMENT_ACTIONS as readonly string[]).includes(action)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Unknown action', 404);
    }
    return this.appointments.act(actor, id, action as AppointmentAction, body);
  }
}

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUEUE_VIEW)
  get(@CurrentActor() actor: Actor, @ValidQuery(queueQuerySchema) q: z.infer<typeof queueQuerySchema>) {
    return this.queue.queue(actor, q.date, q.doctorId);
  }

  @Post('call-next')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUEUE_MANAGE)
  callNext(@CurrentActor() actor: Actor, @ValidBody(callNextSchema) body: z.infer<typeof callNextSchema>) {
    return this.queue.callNext(actor, body.doctorId);
  }

  @Post(':appointmentId/call')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUEUE_MANAGE)
  call(@CurrentActor() actor: Actor, @Param('appointmentId', ParseUUIDPipe) id: string) {
    return this.queue.call(actor, id);
  }

  @Post(':appointmentId/hold')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUEUE_MANAGE)
  hold(@CurrentActor() actor: Actor, @Param('appointmentId', ParseUUIDPipe) id: string) {
    return this.queue.setHold(actor, id, true);
  }

  @Post(':appointmentId/resume')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUEUE_MANAGE)
  resume(@CurrentActor() actor: Actor, @Param('appointmentId', ParseUUIDPipe) id: string) {
    return this.queue.setHold(actor, id, false);
  }
}
