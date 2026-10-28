/**
 * What the triggers need from Databases (decision 0007, section 7): dated rows as the owner sees
 * them, and answers through forms. Until Databases' api.ts and events.ts are on main these are
 * stand-ins with no rows and no answers, so the triggers stay idle.
 */
import type { RowDate } from '@carehub/team-automations/dates';
import type { CivilDate } from '@carehub/team-time';

export interface DatedRowsQuery {
  databaseId: string;
  propertyId: string;
  /** Null: every row rather than a view's. */
  viewId: string | null;
  from: CivilDate;
  /** Exclusive. */
  to: CivilDate;
  /** Decides which days dates with a time fall on. */
  timeZone: string;
}

/**
 * The rows the person can open, not in Trash, whose date overlaps [from, to). Null when the
 * database or the property is gone for them (missing, in Trash, or one they can't open).
 */
export type ListDatedRows = (
  viewer: { userId: string; workspaceId: string },
  query: DatedRowsQuery,
) => Promise<{ rows: (RowDate & { rowId: string })[]; truncated: boolean } | null>;

/** An answer through a form, saved as a row of its database. */
export interface FormAnswer {
  workspaceId: string;
  databaseId: string;
  formId: string;
  rowId: string;
  responseId: string | null;
  /** The respondent; null for anonymous forms (AU-14). */
  respondentId: string | null;
}

/** Calls the handler after each answer is saved; returns a function that stops it. */
export type OnFormAnswer = (handler: (answer: FormAnswer) => Promise<void>) => () => void;

export interface TriggerDatabases {
  listDatedRows: ListDatedRows;
  onFormAnswer: OnFormAnswer;
}

export const databasesStandIn: TriggerDatabases = {
  listDatedRows: () => Promise.resolve({ rows: [], truncated: false }),
  onFormAnswer: () => () => undefined,
};
