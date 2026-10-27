// Who can see and do what in a knowledge base (spec section 5), and the row limiter that hides
// drafts. Everything here is pure: the server gathers the levels and passes them in.
import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  atLeastLevel,
  type KbLevel,
  type KbStatus,
} from './constants';

export type RowValues = Readonly<Record<string, unknown>>;

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * The page's owners. A row whose Owner was never set belongs to its creator ("new pages start as
 * Draft, with their creator as owner"); an empty list means No owner.
 */
export function readOwners(values: RowValues, createdBy: string | null): string[] {
  const raw = values[KB_PROPERTY.owner];
  if (raw === undefined) return createdBy ? [createdBy] : [];
  return [...new Set(ids(raw))];
}

/** Only the Published option publishes; a missing or unknown status is a draft. */
export function readStatus(values: RowValues): KbStatus {
  return values[KB_PROPERTY.status] === KB_STATUS_OPTION.published ? 'published' : 'draft';
}

export function readTags(values: RowValues): string[] {
  return ids(values[KB_PROPERTY.tags]);
}

/** What `registerRowAccessLimiter('wiki', limiter)` passes (decision 0200). */
export interface WikiLimiterInput {
  databaseId: string;
  row: { id: string; values: RowValues; createdBy: string | null };
  properties?: unknown;
  userId: string | null;
  /** The person's level on this row after the row rules. */
  level: KbLevel;
  /** Their level on the wiki database itself, when given; rows turn Can edit content into edit. */
  databaseLevel?: KbLevel;
}

/**
 * Drafts are seen only by their owners and by people with Can edit or Full access on the knowledge
 * base; for everyone else they're a page they can't open. Published pages keep their level.
 */
export function wikiRowLimiter(input: WikiLimiterInput): KbLevel {
  const { row, userId, level } = input;
  if (level === 'none' || readStatus(row.values) === 'published') return level;
  if (atLeastLevel(input.databaseLevel ?? level, 'edit') && atLeastLevel(level, 'edit')) {
    return level;
  }
  return userId !== null && readOwners(row.values, row.createdBy).includes(userId) ? level : 'none';
}

/** One person on one knowledge base page. */
export interface KbActor {
  /** Level on the knowledge base (the wiki database). */
  baseLevel: KbLevel;
  /** Level on this page, after the limiter. */
  pageLevel: KbLevel;
  isOwner: boolean;
}

const opens = (actor: KbActor) => atLeastLevel(actor.pageLevel, 'view');
const owns = (actor: KbActor) => actor.isOwner && opens(actor);
const edits = (actor: KbActor) => opens(actor) && atLeastLevel(actor.baseLevel, 'edit');

/** Publishing, Back to draft and reading drafts. */
export const canPublish = (actor: KbActor) => owns(actor) || edits(actor);
export const canVerify = (actor: KbActor) =>
  owns(actor) || (opens(actor) && actor.baseLevel === 'full');
export const canChangeOwners = edits;
export const canChangeTags = (actor: KbActor) => owns(actor) || edits(actor);
/** Reading, answering and closing a page's reports. */
export const canManageReports = (actor: KbActor) => owns(actor) || edits(actor);

export function canReadReport(actor: KbActor, isReporter: boolean): boolean {
  return (isReporter && opens(actor)) || canManageReports(actor);
}

/** Signed-in people who can open a published page; share-link visitors can't. */
export function canReport(actor: KbActor, status: KbStatus, signedIn: boolean): boolean {
  return signedIn && status === 'published' && opens(actor);
}

export const canAddPages = (baseLevel: KbLevel) => atLeastLevel(baseLevel, 'edit_content');
export const canChangeSettings = (baseLevel: KbLevel) => baseLevel === 'full';

/** Turning a page into a knowledge base, or back: Full access and the Create permission. */
export function canConvert(pageLevel: KbLevel, canCreatePages: boolean): boolean {
  return pageLevel === 'full' && canCreatePages;
}
