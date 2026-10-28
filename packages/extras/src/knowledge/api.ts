// Request bodies for /api/knowledge and the shapes it answers with, shared by server and web.
import { z } from 'zod';
import { KB_LIMITS, KB_STATUSES, type KbStatus } from './constants';
import type { ReportReason, ReportStatus } from './reports';
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

/** A report, for its reporter, the page's owners and the knowledge base's editors only. */
export interface KbReport {
  id: string;
  pageId: string;
  pageTitle: string;
  reason: ReportReason;
  text: string;
  quote: string | null;
  blockId: string | null;
  reporter: KbPerson;
  status: ReportStatus;
  createdAt: string;
  closedAt: string | null;
}

export interface KbReply {
  id: string;
  author: KbPerson;
  text: string;
  createdAt: string;
}

/** GET /api/knowledge/reports/:reportId. */
export interface KbReportDetail {
  report: KbReport;
  replies: KbReply[];
  /** Owners and editors set the status; the reporter can only add to it. */
  canManage: boolean;
}

/** GET /api/knowledge/pages/:pageId/turn-into: the confirm before turning a page into one. */
export interface KbTurnIntoPreview {
  title: string;
  /** The direct sub-pages the person can open: they become knowledge base pages. */
  subPages: number;
  /** "Turn Support handbook into a knowledge base? Its 24 sub-pages become …" */
  text: string;
}

/** GET /api/knowledge/bases/:databaseId/turn-back: what turning it back removes. */
export interface KbTurnBackPreview {
  openReports: number;
  /** "Owner, status, verification, tags and 3 open reports will be removed." */
  text: string;
}

/** GET /api/knowledge/bases/:databaseId/health: the health line on Home, for editors (KB-12). */
export interface KbHealth {
  /** Every page in the knowledge base (the All pages view). */
  pages: number;
  verified: number;
  expired: number;
  openReports: number;
  /** The Needs review view: due for review, or without an owner. */
  needsReview: number;
  /** Whole percent verified, or null when there are no pages. */
  percent: number | null;
  /** "86% verified · 4 expired · 2 open reports", or null when there are no pages. */
  text: string | null;
}
