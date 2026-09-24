import { z } from 'zod';
import { ROLE_KEYS } from '../roles';
import { ALL_PERMISSIONS } from '../permissions';
import { emailSchema, optionalText, passwordSchema, phoneSchema, requiredText, uuidSchema } from '../validation';

export const roleKeySchema = z.enum(ROLE_KEYS as [string, ...string[]]);

export const doctorProfileSchema = z.object({
  qualifications: optionalText(300),
  specialty: optionalText(150),
  registrationNo: optionalText(80),
  consultationFee: z.number().min(0).max(1_000_000).nullish(),
  followUpFee: z.number().min(0).max(1_000_000).nullish(),
  bio: optionalText(1000),
});
export type DoctorProfileInput = z.infer<typeof doctorProfileSchema>;

export const createUserSchema = z.object({
  fullName: requiredText(150),
  email: emailSchema,
  phone: phoneSchema.nullish(),
  password: passwordSchema,
  role: roleKeySchema,
  /**
   * Target chamber for chamber-scoped roles. Super admins must provide it;
   * for managers it defaults to (and must equal) their own chamber.
   */
  chamberId: uuidSchema.nullish(),
  preferredLanguage: z.enum(['en', 'bn']).default('en'),
  doctorProfile: doctorProfileSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: requiredText(150).optional(),
  phone: phoneSchema.nullish(),
  preferredLanguage: z.enum(['en', 'bn']).optional(),
  doctorProfile: doctorProfileSchema.optional(),
  version: z.number().int().min(1),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserStatusSchema = z.object({
  isActive: z.boolean(),
  reason: requiredText(500),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

export const adminResetPasswordSchema = z.object({
  newPassword: passwordSchema,
  reason: requiredText(500),
});
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;

export const userListQuerySchema = z.object({
  role: roleKeySchema.optional(),
  chamberId: uuidSchema.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(200),
  reason: requiredText(500),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
