import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema, uuidSchema } from '../validation';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'validation.password.same_as_current',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const switchChamberSchema = z.object({ membershipId: uuidSchema });
export type SwitchChamberInput = z.infer<typeof switchChamberSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'validation.required').max(150).optional(),
  phone: phoneSchema.nullish(),
  preferredLanguage: z.enum(['en', 'bn']).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
