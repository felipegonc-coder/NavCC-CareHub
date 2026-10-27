import { z } from 'zod';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema, LIMITS } from '../format/index';
import { isCertificateCodeWellFormed, normalizeCertificateCode } from './code';
import { CERTIFICATE_STATUSES } from './expiry';

// Request and response schemas for the certificate endpoints (docs/learning/api.md).

const SYMBOL = '[0-9A-HJKMNP-TV-Z]';
const CODE_PATTERN = new RegExp(`^${SYMBOL}{4}-${SYMBOL}{4}-${SYMBOL}{4}$`);
const CODE_HINT = 'Use the 12-character code on the certificate, e.g. 7KQ2-M9XD-4TB8.';

/** Where a certificate stands on the day the server answers (`certificateStatus`). */
export const CertificateStatusSchema = z.enum(CERTIFICATE_STATUSES);

/** A verification code as issued: "XXXX-XXXX-XXXX" in Crockford base32 with a matching check symbol. */
export const CertificateCodeSchema = z
  .string()
  .regex(CODE_PATTERN, { error: CODE_HINT })
  .refine(isCertificateCodeWellFormed, { error: 'This code has a typo. Check it and try again.' });

/** A certificate as GET /certificates and GET /certificates/:id send it. */
export const CertificateSchema = z.strictObject({
  id: IdSchema,
  code: CertificateCodeSchema,
  learnerId: IdSchema,
  learnerName: z.string().max(LIMITS.title),
  courseId: IdSchema,
  /** The title of the course version the learner finished. */
  courseTitle: z.string().min(1).max(LIMITS.title),
  courseVersion: z.number().int().min(1),
  /** When the learner passed or completed the course; each finish gets at most one certificate. */
  completedAt: IsoDateTimeSchema,
  /** The calendar day of `completedAt` in the workspace's time zone. */
  issuedOn: IsoDateSchema,
  /** Null when the course sets no expiry. */
  expiresOn: IsoDateSchema.nullable(),
  /** The course score when it was finished (graded quizzes only), or null without one. */
  score: z.number().min(0).max(100).nullable(),
  status: CertificateStatusSchema,
});
export type Certificate = z.infer<typeof CertificateSchema>;

/**
 * GET /certificates query. Without filters a learner gets their own certificates. `personId` and
 * `courseId` filter (someone else's certificates need learning.analytics, or being their manager).
 * `code` looks a code up to verify it: any spelling `normalizeCertificateCode` accepts, read as
 * "XXXX-XXXX-XXXX".
 */
export const CertificateListQuerySchema = z.strictObject({
  personId: IdSchema.optional(),
  courseId: IdSchema.optional(),
  code: z
    .string()
    .max(40)
    .refine((code) => normalizeCertificateCode(code) !== null, { error: CODE_HINT })
    .transform((code) => normalizeCertificateCode(code) ?? code)
    .optional(),
});
export type CertificateListQuery = z.infer<typeof CertificateListQuerySchema>;

/** GET /certificates: newest first. */
export const CertificateListResponseSchema = z.array(CertificateSchema);
