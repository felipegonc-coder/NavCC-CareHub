// Who is opening a form and what the server knows right now, for the package's formGate (Forms
// spec, section 2): their place in the workspace, their level on the database, how many responses
// the form has and when they last sent one. The rules themselves are formGate's.
import type { AccessLevel, FormDefinition } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { formAudience, formGate, isAnonymousForm, type FormGate } from '@carehub/databases/forms';
import { sql } from 'drizzle-orm';
import type { DatabaseRecord } from '../databases/record';
import type { Executor } from '../databases/store';
import { getAccessForPages } from '../pages';

/** 'outsider': signed in, but neither a member nor a guest of the form's workspace. */
export type Visitor = 'member' | 'guest' | 'outsider' | 'signed_out';

export interface Visit {
  record: DatabaseRecord;
  form: FormDefinition;
  /** The code that was opened, or null in the database's Form view. */
  linkCode: string | null;
  visitor: Visitor;
  /** Their level on the database. */
  level: AccessLevel;
  /**
   * The form's responses towards maxResponses. Rows in Trash don't count, and deleted ones are
   * gone, so deleting a response frees a place. Restoring one may go over the maximum, which only
   * stops new answers.
   */
  responseCount: number;
  /** When this person last responded (ISO), for forms that record who responds. */
  respondedAt: string | null;
  workspaceName: string;
  now: Date;
  timeZone?: string;
}

/**
 * The gate for this visit. Someone signed in from outside the workspace gets the members-only
 * answer ("This form is only for members of Blue Pine Plumbing."), unless anyone can respond.
 */
export function gateOf(visit: Visit): FormGate {
  const outsider = visit.visitor === 'outsider';
  const form =
    outsider && formAudience(visit.form) !== 'anyone'
      ? { ...visit.form, audience: 'members' as const }
      : visit.form;
  return formGate(form, {
    linkCode: visit.linkCode,
    visitor: visit.visitor === 'outsider' ? 'guest' : visit.visitor,
    canEdit: !outsider && can('submit_form', visit.level, { locked: visit.record.locked }),
    inTrash: visit.record.inTrash,
    responseCount: visit.responseCount,
    respondedAt: isAnonymousForm(form) ? null : visit.respondedAt,
    workspaceName: visit.workspaceName,
    now: visit.now,
    ...(visit.timeZone ? { timeZone: visit.timeZone } : {}),
  });
}

/**
 * What a code that Change link replaced shows: the package's link_changed words. formGate
 * compares the code first, so nothing else about the visit is read; any other state means the
 * code is still the form's.
 */
export function replacedCodeGate(form: FormDefinition, code: string): FormGate {
  return formGate(form, {
    linkCode: code,
    visitor: 'signed_out',
    canEdit: false,
    inTrash: false,
    responseCount: 0,
    respondedAt: null,
    workspaceName: '',
    now: new Date(),
  });
}

/** A signed-in person's visit, read with `db` (a submit passes its transaction). */
export async function visitFor(
  db: Executor,
  input: {
    record: DatabaseRecord;
    form: FormDefinition;
    viewId: string;
    linkCode: string | null;
    user: { id: string; timeZone: string };
  },
): Promise<Visit> {
  const { record, form, user } = input;
  const sender = isAnonymousForm(form) ? null : user.id;
  const [place, levels, stats] = await Promise.all([
    db.execute<{ kind: string | null; name: string }>(sql`
      SELECT m.kind, w.name FROM workspaces w
      LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${user.id}
      WHERE w.id = ${record.workspaceId}`),
    getAccessForPages(db, user.id, [record.id]),
    db.execute<{ count: number; responded_at: Date | string | null }>(sql`
      SELECT count(*)::int AS count,
        max(r.created_at) FILTER (WHERE r.created_by = ${sender}::uuid) AS responded_at
      FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.database_id = ${record.id} AND r.form_view_id = ${input.viewId}
        AND p.deleted_at IS NULL`),
  ]);
  const kind = place.rows[0]?.kind;
  const respondedAt = stats.rows[0]?.responded_at ?? null;
  return {
    record,
    form,
    linkCode: input.linkCode,
    visitor: kind === 'member' || kind === 'guest' ? kind : 'outsider',
    level: levels.get(record.id) ?? 'none',
    responseCount: stats.rows[0]?.count ?? 0,
    respondedAt: respondedAt === null ? null : new Date(respondedAt).toISOString(),
    workspaceName: place.rows[0]?.name ?? '',
    now: new Date(),
    timeZone: user.timeZone,
  };
}
