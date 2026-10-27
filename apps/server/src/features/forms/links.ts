// Form link codes (decision 0200). forms_links keeps one live code per form, written in the same
// transaction as the form: the databases feature's view and database writes keep a new form's
// code, and "Change link" here revokes it and keeps the new one. Codes are looked up only there,
// by primary key, never in the views.
import { randomBytes } from 'node:crypto';
import type { FormDefinition, View } from '@carehub/databases';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db';
import type { DatabaseRecord } from '../databases/record';
import { saveSettings, type Executor } from '../databases/store';

/** A new link code: 16 random bytes as base64url (0200's security conditions). */
export const newLinkCode = (): string => randomBytes(16).toString('base64url');

/** Codes are base64url (the package's default form: 32 hex digits); others are never looked up. */
const CODE_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;

export const isLinkCode = (value: unknown): value is string =>
  typeof value === 'string' && CODE_FORMAT.test(value);

/** The form a code opens. */
export interface FormLink {
  code: string;
  databaseId: string;
  viewId: string;
  /** Not live any more: Change link replaced it, or its form was deleted. */
  revoked: boolean;
}

/** A form view: a view with layout 'form' and its form. */
export type FormView = View & { form: FormDefinition };

/** The database's form view with this id, or null. */
export function formViewOf(record: DatabaseRecord, viewId: string): FormView | null {
  const view = record.views.find((v) => v.id === viewId);
  return view && view.layout === 'form' && view.form ? (view as FormView) : null;
}

/** The form this code opens (live or revoked), or null when it was never a code. */
export async function findLink(db: Executor, code: string): Promise<FormLink | null> {
  if (!isLinkCode(code)) return null;
  const found = await db.execute<{ database_id: string; view_id: string; revoked: boolean }>(sql`
    SELECT database_id, view_id, revoked_at IS NOT NULL AS revoked
    FROM forms_links WHERE code = ${code}`);
  const row = found.rows[0];
  if (!row) return null;
  return { code, databaseId: row.database_id, viewId: row.view_id, revoked: row.revoked };
}

/**
 * Holds the form's lock until the transaction ends, so its responses (and Change link) take
 * turns: the close date, the maximum and one response per person are checked and written
 * atomically. Take it first: a submit then counts and inserts without locking the database's
 * row, and Change link locks the form, then the database.
 */
export async function lockForm(tx: Tx, databaseId: string, viewId: string): Promise<void> {
  const key = `forms:${databaseId}:${viewId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export interface ChangedLink {
  linkCode: string;
  linkChangedAt: string;
  /** The database's new version (the form's view changed). */
  version: number;
}

/**
 * "Change link": the live code revoked (it stops working at once), a new live code, and the view
 * saved with it. In the caller's transaction, after lockForm and lockDatabase.
 */
export async function changeLink(
  tx: Tx,
  record: DatabaseRecord,
  view: FormView,
): Promise<ChangedLink> {
  const linkCode = newLinkCode();
  const linkChangedAt = new Date().toISOString();
  await tx.execute(sql`
    UPDATE forms_links SET revoked_at = now()
    WHERE database_id = ${record.id} AND view_id = ${view.id} AND revoked_at IS NULL`);
  await tx.execute(sql`
    INSERT INTO forms_links (code, database_id, view_id)
    VALUES (${linkCode}, ${record.id}, ${view.id})`);
  const views = record.views.map((v) =>
    v.id === view.id ? { ...view, form: { ...view.form, linkCode, linkChangedAt } } : v,
  );
  const saved = await saveSettings(tx, record, { views });
  return { linkCode, linkChangedAt, version: saved.version };
}
