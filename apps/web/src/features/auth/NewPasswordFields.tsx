import { z } from 'zod';
import { passwordSchema } from '@chamber/shared';

/** New password + confirmation, validated with the shared password policy. */
export const newPasswordFormSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'auth.passwords_mismatch' });

export type NewPasswordForm = z.infer<typeof newPasswordFormSchema>;
