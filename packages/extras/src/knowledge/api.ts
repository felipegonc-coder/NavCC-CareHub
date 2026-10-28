// Request bodies for /api/knowledge and the shapes it answers with, shared by server and web.
import { z } from 'zod';
import { KB_LIMITS, KB_STATUSES, type KbStatus } from './constants';
import type { CivilDate } from './time';
import { VERIFY_PERIODS, civilDateSchema, type VerifyPeriod } from './verification';

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

export interface KbPerson {
  id: string;
  name: string;
}

export interface KbSettings {
  defaultPeriod: VerifyPeriod;
  editingRemovesVerification: boolean;
}

/** GET /api/knowledge/pages/:pageId: what the strip, the banners and the menus need. */
export interface KbPageInfo {
  pageId: string;
  databaseId: string;
  /** The knowledge base's title; empty when the viewer can't open it. */
  baseTitle: string;
  status: KbStatus;
  owners: (KbPerson & { canOpen: boolean })[];
  verification: {
    state: 'verified' | 'expired';
    verifiedBy: KbPerson;
    verifiedAt: string;
    until: CivilDate | null;
  } | null;
  tags: { id: string; name: string; color: string }[];
  /** Null unless the viewer can read this page's reports. */
  openReports: number | null;
  /** Today in the viewer's time zone, for "Oct 1" or "Jan 20, 2027". */
  today: CivilDate;
  defaultPeriod: VerifyPeriod;
  can: {
    publish: boolean;
    verify: boolean;
    changeOwners: boolean;
    changeTags: boolean;
    manageReports: boolean;
    report: boolean;
  };
}
