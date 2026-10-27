// Form link codes (decision 0200). forms_links keeps one live code per form, so a link finds its
// form without reading every database, and "Change link" retires the old code at once. A form
// whose code isn't kept yet (made by a settings write, or before forms_links) gets its row the
// first time its link is read.
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

/** The form a code opens. `revoked`: Change link (or deleting the form) retired the code. */
export interface FormLink {
  code: string;
  databaseId: string;
  viewId: string;
  revoked: boolean;
}

/** A form view: a view with layout 'form' and its form. */
export type FormView = View & { form: FormDefinition };

/** The database's form view with this id, or null. */
export function formViewOf(record: DatabaseRecord, viewId: string): FormView | null {
  const view = record.views.find((v) => v.id === viewId);
  return view && view.layout === 'form' && view.form ? (view as FormView) : null;
}

/**
 * The form's definition as a link sees it: a revoked code never opens the form, even if the view
 * still holds it (formGate then answers "This form link has changed.").
 */
export function definitionForLink(form: FormDefinition, link: FormLink | null): FormDefinition {
  return link?.revoked && form.linkCode === link.code ? { ...form, linkCode: '' } : form;
}

/** What this code opens, or null when no form has it. */
export async function findLink(db: Executor, code: string): Promise<FormLink | null> {
  if (!isLinkCode(code)) return null;
  const kept = await db.execute<{ database_id: string; view_id: string; revoked: boolean }>(sql`
    SELECT database_id, view_id, revoked_at IS NOT NULL AS revoked
    FROM forms_links WHERE code = ${code}`);
  const row = kept.rows[0];
  if (row) return { code, databaseId: row.database_id, viewId: row.view_id, revoked: row.revoked };
  const found = await db.execute<{ database_id: string; view_id: string }>(sql`
    SELECT d.page_id AS database_id, v.view ->> 'id' AS view_id
    FROM db_databases d CROSS JOIN LATERAL jsonb_array_elements(d.views) AS v(view)
    WHERE d.views @> ${JSON.stringify([{ form: { linkCode: code } }])}::jsonb
      AND v.view -> 'form' ->> 'linkCode' = ${code}
    LIMIT 1`);
  const hit = found.rows[0];
  if (!hit) return null;
  // First read: keep the code, unless the form already has a live one.
  await db.execute(sql`
    INSERT INTO forms_links (code, database_id, view_id)
    VALUES (${code}, ${hit.database_id}, ${hit.view_id})
    ON CONFLICT DO NOTHING`);
  return { code, databaseId: hit.database_id, viewId: hit.view_id, revoked: false };
}

/**
 * Holds the form's lock until the transaction ends, so its responses (and Change link) take
 * turns: the close date, the maximum and one response per person are checked and written
 * atomically. Take it before the database's row: Change link locks the form, then the database.
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
 * "Change link": a new live code for the form, the old one revoked (it then shows "This form link
 * has changed."), and the view saved with the new code. In the caller's transaction, after
 * lockForm and lockDatabase.
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
  // The old code may never have been kept (a form whose link was never opened).
  await tx.execute(sql`
    INSERT INTO forms_links (code, database_id, view_id, revoked_at)
    VALUES (${view.form.linkCode}, ${record.id}, ${view.id}, now())
    ON CONFLICT (code) DO NOTHING`);
  await tx.execute(sql`
    INSERT INTO forms_links (code, database_id, view_id)
    VALUES (${linkCode}, ${record.id}, ${view.id})`);
  const views = record.views.map((v) =>
    v.id === view.id ? { ...view, form: { ...view.form, linkCode, linkChangedAt } } : v,
  );
  const saved = await saveSettings(tx, record, { views });
  return { linkCode, linkChangedAt, version: saved.version };
}
