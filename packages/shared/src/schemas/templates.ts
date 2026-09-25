import { z } from 'zod';
import { optionalText, requiredText } from '../validation';
import { diagnosisItemSchema, investigationItemSchema } from './clinical';
import { prescriptionItemSchema, refineItems } from './prescriptions';

// ───────────── Templates (spec §11) ─────────────

const templateBase = z.object({
  name: requiredText(120),
  description: optionalText(300),
  /** Shared with the whole chamber; otherwise personal to the creating doctor. */
  shared: z.boolean().default(false),
  diagnoses: z.array(diagnosisItemSchema).max(20).default([]),
  investigations: z.array(investigationItemSchema).max(40).default([]),
  items: z.array(prescriptionItemSchema).max(40).default([]),
  advice: optionalText(2000),
  followUpInstructions: optionalText(500),
});

function refineTemplate(v: z.infer<typeof templateBase>, ctx: z.RefinementCtx) {
  refineItems(v.items, ctx, ['items']);
  if (!v.items.length && !v.diagnoses.length && !v.investigations.length && !v.advice) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'validation.template_empty',
    });
  }
}

export const prescriptionTemplateSchema = templateBase.superRefine(refineTemplate);
export type PrescriptionTemplateInput = z.infer<typeof prescriptionTemplateSchema>;

export const updatePrescriptionTemplateSchema = templateBase.extend({ version: z.number().int().min(1) }).superRefine(refineTemplate);
export type UpdatePrescriptionTemplateInput = z.infer<typeof updatePrescriptionTemplateSchema>;
