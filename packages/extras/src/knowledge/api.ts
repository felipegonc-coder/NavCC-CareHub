// Request bodies for /api/knowledge, checked by the server and used by the web app.
import { z } from 'zod';
import { KB_LIMITS, KB_STATUSES } from './constants';
import { VERIFY_PERIODS, civilDateSchema } from './verification';

export const verifyInputSchema = z
  .strictObject({
    period: z.enum([...VERIFY_PERIODS, 'date']),
    until: civilDateSchema.optional(),
  })
  .refine((input) => (input.period === 'date') === (input.until !== undefined), {
    error: 'Pick a date.',
    path: ['until'],
  });
export type VerifyInput = z.infer<typeof verifyInputSchema>;

export const statusInputSchema = z.strictObject({ status: z.enum(KB_STATUSES) });

export const ownersInputSchema = z.strictObject({
  owners: z
    .array(z.uuid({ error: "That person ID isn't right." }))
    .max(KB_LIMITS.ownersPerPage, { error: 'A page can have up to 5 owners.' })
    .refine((owners) => new Set(owners).size === owners.length, { error: 'Pick each owner once.' }),
});

export const settingsInputSchema = z
  .strictObject({
    defaultPeriod: z.enum(VERIFY_PERIODS).optional(),
    editingRemovesVerification: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: 'Nothing to change.',
  });

/** The review bar: Verify for the default period, Needs changes, or Archive. */
export const reviewInputSchema = z.strictObject({
  action: z.enum(['verify', 'needs_changes', 'archive']),
});
