import { z } from 'zod';
import { emailSchema, optionalText, phoneSchema, requiredText, uuidSchema } from '../validation';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'validation.slug');

export const createOrganizationSchema = z.object({
  name: requiredText(150),
  slug: slugSchema,
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  address: optionalText(500),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  isActive: z.boolean().optional(),
  version: z.number().int().min(1),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const createChamberSchema = z.object({
  organizationId: uuidSchema,
  name: requiredText(150),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(12)
    .regex(/^[A-Z0-9]+$/, 'validation.code'),
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  address: optionalText(500),
  timezone: z.string().trim().max(64).default('Asia/Dhaka'),
});
export type CreateChamberInput = z.infer<typeof createChamberSchema>;

export const updateChamberSchema = createChamberSchema
  .omit({ organizationId: true, code: true })
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    version: z.number().int().min(1),
  });
export type UpdateChamberInput = z.infer<typeof updateChamberSchema>;

export const deleteWithReasonSchema = z.object({
  reason: requiredText(500),
});
export type DeleteWithReasonInput = z.infer<typeof deleteWithReasonSchema>;
