import { z } from 'zod';
import { APPOINTMENT_STATUSES, VISIT_TYPES } from '../appointments';
import { optionalText, requiredText, uuidSchema } from '../validation';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'validation.time');
export const durationSchema = z.number().int().min(5).max(240);

export const createAppointmentSchema = z.object({
  patientId: uuidSchema,
  doctorId: uuidSchema,
  /** Wall-clock date/time in the chamber's timezone. */
  date: dateString,
  time: timeString,
  durationMinutes: durationSchema.optional(),
  visitType: z.enum(VISIT_TYPES).default('NEW'),
  reason: optionalText(300),
  notes: optionalText(1000),
  /** Walk-in: book now and check in immediately. */
  checkInNow: z.boolean().default(false),
  /** Confirms booking outside the doctor's schedule or beyond the daily limit. */
  allowOverbook: z.boolean().default(false),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  date: dateString,
  time: timeString,
  doctorId: uuidSchema.optional(),
  durationMinutes: durationSchema.optional(),
  reason: optionalText(300),
  allowOverbook: z.boolean().default(false),
  version: z.number().int().min(1),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const updateAppointmentDetailsSchema = z.object({
  visitType: z.enum(VISIT_TYPES).optional(),
  reason: optionalText(300),
  notes: optionalText(1000),
  version: z.number().int().min(1),
});
export type UpdateAppointmentDetailsInput = z.infer<typeof updateAppointmentDetailsSchema>;

/** Status actions exposed as endpoints; `reason` is required for cancel / no-show. */
export const APPOINTMENT_ACTIONS = ['confirm', 'check-in', 'send-to-queue', 'start', 'complete', 'return-to-queue', 'cancel', 'no-show'] as const;
export type AppointmentAction = (typeof APPOINTMENT_ACTIONS)[number];

export const appointmentActionSchema = z.object({
  reason: optionalText(500),
  version: z.number().int().min(1).optional(),
});
export type AppointmentActionInput = z.infer<typeof appointmentActionSchema>;

export const appointmentListQuerySchema = z.object({
  from: dateString,
  to: dateString,
  doctorId: uuidSchema.optional(),
  patientId: uuidSchema.optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(APPOINTMENT_STATUSES))),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

export const availabilityQuerySchema = z.object({
  doctorId: uuidSchema,
  date: dateString,
  excludeAppointmentId: uuidSchema.optional(),
});

export const queueQuerySchema = z.object({
  date: dateString.optional(),
  doctorId: uuidSchema.optional(),
});

export const callNextSchema = z.object({ doctorId: uuidSchema });

export const scheduleWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeString,
    endTime: timeString,
  })
  .refine((w) => w.startTime < w.endTime, { path: ['endTime'], message: 'validation.end_after_start' });

export const doctorScheduleSchema = z
  .object({
    windows: z.array(scheduleWindowSchema).max(28),
    slotMinutes: durationSchema.nullish(),
    maxDailyPatients: z.number().int().min(1).max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    for (let i = 0; i < v.windows.length; i++) {
      for (let j = i + 1; j < v.windows.length; j++) {
        const a = v.windows[i]!;
        const b = v.windows[j]!;
        if (a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime) {
          ctx.addIssue({ code: 'custom', path: ['windows', j, 'startTime'], message: 'validation.window_overlap' });
        }
      }
    }
  });
export type DoctorScheduleInput = z.infer<typeof doctorScheduleSchema>;

export const appointmentSettingsSchema = z.object({
  defaultSlotMinutes: durationSchema,
  /** Per-doctor daily cap unless the doctor overrides it; null = unlimited. */
  maxDailyPatients: z.number().int().min(1).max(500).nullable(),
  /** Token numbering restarts daily, either per doctor or across the chamber. */
  tokenScope: z.enum(['DOCTOR', 'CHAMBER']),
  tokenPrefix: z.string().trim().max(4).regex(/^[A-Za-z0-9]*$/, 'validation.code'),
  /** Check-in puts the patient straight into the doctor's waiting queue. */
  autoQueueOnCheckIn: z.boolean(),
  workingDaysHint: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});
export type AppointmentSettings = z.infer<typeof appointmentSettingsSchema>;

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  defaultSlotMinutes: 15,
  maxDailyPatients: null,
  tokenScope: 'DOCTOR',
  tokenPrefix: '',
  autoQueueOnCheckIn: true,
};

export const updateAppointmentSettingsSchema = appointmentSettingsSchema.extend({ version: z.number().int().min(0) });
export type UpdateAppointmentSettingsInput = z.infer<typeof updateAppointmentSettingsSchema>;

export const requiredReason = requiredText(500);
