// Names and limits every part of the knowledge base shares (docs/plan/specs/knowledge-base.md).

/**
 * The built-in properties of a wiki database, with fixed IDs so the server, the web app and the
 * row limiter find them without a lookup. They can't be deleted while it's a knowledge base.
 */
export const KB_PROPERTY = {
  owner: 'kb_owner',
  status: 'kb_status',
  verification: 'kb_verification',
  tags: 'kb_tags',
} as const;

/** The two options of the Status property. New pages start as Draft. */
export const KB_STATUS_OPTION = { draft: 'kb_draft', published: 'kb_published' } as const;

export const KB_STATUSES = ['draft', 'published'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const KB_LIMITS = {
  ownersPerPage: 5,
  pagesPerBase: 5000,
  reportText: 2000,
  reportQuote: 500,
  replyText: 2000,
  /** Reporting the same page again within this many days asks to add to the earlier report. */
  repeatReportDays: 7,
  /** Needs review and the Monday summary include pages expiring within this many days. */
  reviewWindowDays: 14,
} as const;

/** Pages expire, and the Monday summary goes out, at this time in the owner's time zone. */
export const KB_NOTICE_TIME = '09:00';

/** Access levels, lowest first: the same list as `ACCESS_LEVELS` in @carehub/shared (0007). */
export const KB_LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'] as const;
export type KbLevel = (typeof KB_LEVELS)[number];

export function atLeastLevel(level: KbLevel, min: KbLevel): boolean {
  return KB_LEVELS.indexOf(level) >= KB_LEVELS.indexOf(min);
}
