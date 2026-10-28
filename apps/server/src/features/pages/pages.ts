// Making, reading and changing pages, databases and rows (decision 0007, section 4.1; Pages and
// blocks 3.1). Like every service function here, these take Db | Tx, leave access checks to the
// caller and never emit events: the caller knows when its transaction commits.
import {
  updatePageSchema,
  type AccessLevel,
  type PageAncestor,
  type PageIcon,
  type PageJson,
  type PageCover,
  type PageKind,
  type UpdatePageInput,
} from '@carehub/shared';
import { sql, type SQL } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import { memberOf, resolvePages, type Executor, type Viewer } from './access';
import { invalid, iso, isUuid, json, notFound, spaceArchived, uuidArray } from './http';
import { positionAt } from './position';
import { getPrivateSpaceId } from './spaces';

export type NewPage = {
  workspaceId: string;
  /** With no parent and no space, the page goes in the creator's Private section. */
  spaceId?: string;
  parentId?: string | null;
  kind: PageKind;
  title?: string;
  icon?: PageIcon | null;
  isInline?: boolean;
  createdBy: string;
  /** Its place among the pages next to it (0 is first); last when left out. */
  index?: number;
  /** False: it starts with only its own grants, like after "Stop inheriting" (meeting notes). */
  inheritAccess?: boolean;
};

/** How deep pages may nest, top level included: the sidebar and the access walks stay quick. */
export const MAX_DEPTH = 100;
export const tooDeep = () => invalid(`Pages can nest up to ${MAX_DEPTH} levels deep.`);
/** Any change to a locked page but unlocking it (decision 0012, point 13). */
export const pageLocked = () =>
  httpError(403, 'forbidden', 'This page is locked. Unlock it to change it.');
/** A change to an archived page, or a page added or moved under one (decision 0012, point 17). */
export const pageArchived = () =>
  httpError(409, 'conflict', 'This page is archived. Unarchive it first.');

export type PageRow = {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentId: string | null;
  kind: PageKind;
  isInline: boolean;
  title: string;
  position: string;
};

/**
 * 0007: makes a page, database or row and returns it. Rows go in a database and nothing else
 * does; an inline database sits on a page. A parent is always in the same space. The creator gets
 * a person grant of Full access on it (Can edit for a guest), still limited by their role.
 */
export async function createPage(tx: Executor, input: NewPage): Promise<PageRow> {
  const page = await insertPage(tx, input);
  await grantCreator(tx, page, input.createdBy);
  return page;
}

/** The creator's grant on a new page. It isn't a sharing change, so access history skips it. */
export async function grantCreator(tx: Executor, page: PageRow, by: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO access_grants (workspace_id, page_id, principal_type, principal_id, level,
      granted_by)
    SELECT m.workspace_id, ${page.id}::uuid, 'user', m.user_id,
      CASE WHEN m.kind = 'guest' THEN 'edit' ELSE 'full' END, m.user_id
    FROM workspace_members m WHERE m.workspace_id = ${page.workspaceId}::uuid
      AND m.user_id = ${by}::uuid AND m.removed_at IS NULL`);
}

/** createPage without the creator's grant, for callers that check access in between. */
export async function insertPage(tx: Executor, input: NewPage): Promise<PageRow> {
  const { workspaceId, kind, createdBy, parentId = null, isInline = false } = input;
  let spaceId = input.spaceId;
  if (parentId !== null) {
    if (!isUuid(parentId)) throw notFound();
    type Parent = { spaceId: string; kind: PageKind; archived: boolean };
    const { rows } = await tx.execute<Parent>(sql`
      SELECT space_id AS "spaceId", kind, archived_at IS NOT NULL AS archived FROM pages
      WHERE id = ${parentId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL FOR SHARE`);
    const parent = rows[0];
    if (!parent) throw notFound();
    if (parent.archived) throw pageArchived();
    if ((await depthOf(tx, parentId)) >= MAX_DEPTH) throw tooDeep();
    if (spaceId !== undefined && spaceId !== parent.spaceId) {
      throw invalid('The parent page is in another space.');
    }
    if ((parent.kind === 'database') !== (kind === 'row')) {
      throw invalid(kind === 'row' ? 'Rows go in a database.' : 'Only rows go in a database.');
    }
    spaceId = parent.spaceId;
  } else if (kind === 'row' || isInline) {
    throw invalid(kind === 'row' ? 'Rows go in a database.' : 'An inline database sits on a page.');
  }
  spaceId ??= await getPrivateSpaceId(tx, createdBy, workspaceId);
  if (!isUuid(spaceId)) throw notFound();
  if (isInline && kind !== 'database') throw invalid('Only databases can be inline.');
  const { rows: siblings } = await tx.execute<{ position: string }>(sql`
    SELECT position FROM pages
    WHERE space_id = ${spaceId} AND parent_id IS NOT DISTINCT FROM ${parentId}::uuid
      AND deleted_at IS NULL
    ORDER BY position`);
  const position = positionAt(
    siblings.map((sibling) => sibling.position),
    input.index,
  );
  const { rows } = await tx.execute<PageRow>(sql`
    INSERT INTO pages (workspace_id, space_id, parent_id, kind, is_inline, title, icon, position,
      inherit_access, created_by, updated_by)
    SELECT s.workspace_id, s.id, ${parentId}::uuid, ${kind}::text, ${isInline}::boolean,
      ${input.title ?? ''}::text, ${json(input.icon)}::jsonb, ${position}::text,
      ${input.inheritAccess ?? true}::boolean, ${createdBy}::uuid, ${createdBy}::uuid
    FROM spaces s
    WHERE s.id = ${spaceId} AND s.workspace_id = ${workspaceId} AND s.deleted_at IS NULL
    RETURNING id, workspace_id AS "workspaceId", space_id AS "spaceId", parent_id AS "parentId",
      kind, is_inline AS "isInline", title, position`);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** How many levels down the page is: 1 at the top of its space, 0 when there's no such page. */
export async function depthOf(db: Executor, pageId: string): Promise<number> {
  const { rows } = await db.execute<{ depth: number }>(sql`
    WITH RECURSIVE up AS (
      SELECT parent_id, 1 AS depth FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.parent_id, up.depth + 1 FROM up JOIN pages p ON p.id = up.parent_id
      WHERE up.depth < 1000
    )
    SELECT coalesce(max(depth), 0)::int AS depth FROM up`);
  return rows[0]?.depth ?? 0;
}

/**
 * 0007: where the page is, for features that file things under it; null when there's no such
 * page. `inTrash` when the page, a page above it or its space is in Trash.
 */
export async function getPagePlace(db: Executor, pageId: string) {
  const id = isUuid(pageId) ? pageId : null;
  const { rows } = await db.execute<{
    workspaceId: string;
    spaceId: string;
    parentId: string | null;
    inTrash: boolean;
  }>(sql`
    WITH RECURSIVE up AS (
      SELECT parent_id, deleted_at, 1 AS depth FROM pages WHERE id = ${id}::uuid
      UNION ALL
      SELECT p.parent_id, p.deleted_at, up.depth + 1 FROM up JOIN pages p ON p.id = up.parent_id
      WHERE up.depth < 1000
    )
    SELECT p.workspace_id AS "workspaceId", p.space_id AS "spaceId", p.parent_id AS "parentId",
      s.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM up WHERE up.deleted_at IS NOT NULL)
        AS "inTrash"
    FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = ${id}::uuid`);
  return rows[0] ?? null;
}

const STYLE_KEYS = ['font', 'smallText', 'textDirection'] as const;

/**
 * Changes a page's title, icon, cover, width, style or lock (all need Can edit). Lock and unlock
 * record who; a locked page refusing other changes is the caller's check.
 */
export async function updatePage(
  tx: Executor,
  pageId: string,
  changes: UpdatePageInput,
  by: string,
): Promise<void> {
  const { title, icon, cover, coverPosition, fullWidth, locked } = changes;
  // Pictures need the files API's checks (Pages and blocks 5), so they wait for it.
  if (cover?.type === 'file') throw invalid('Uploaded covers come with file uploads.');
  const sets: SQL[] = [];
  if (title !== undefined) sets.push(sql`title = ${title}`);
  if (icon !== undefined) sets.push(sql`icon = ${json(icon)}::jsonb`);
  if (cover !== undefined) sets.push(sql`cover = ${json(cover)}::jsonb`);
  if (coverPosition !== undefined) sets.push(sql`cover_position = ${coverPosition}`);
  if (fullWidth !== undefined) sets.push(sql`full_width = ${fullWidth}`);
  const style = Object.fromEntries(
    STYLE_KEYS.flatMap((key) => (changes[key] === undefined ? [] : [[key, changes[key]]])),
  );
  if (Object.keys(style).length > 0)
    sets.push(sql`style = style || ${JSON.stringify(style)}::jsonb`);
  if (locked === true) {
    sets.push(sql`locked_by = CASE WHEN locked_at IS NULL THEN ${by}::uuid ELSE locked_by END,
      locked_at = coalesce(locked_at, now())`);
  }
  if (locked === false) sets.push(sql`locked_by = NULL, locked_at = NULL`);
  if (sets.length === 0 || !isUuid(pageId)) return;
  const { rows } = await tx.execute(sql`
    UPDATE pages SET ${sql.join(sets, sql`, `)}, updated_by = ${by}, updated_at = now()
    WHERE id = ${pageId} AND deleted_at IS NULL RETURNING id`);
  if (rows.length === 0) throw notFound();
}

/** 0007: renames a page, database or row. */
export async function setPageTitle(tx: Executor, pageId: string, title: string, by: string) {
  if (title.length > 2000) throw invalid('A title can be up to 2,000 characters.');
  await updatePage(tx, pageId, { title: title.replace(/[\r\n]+/g, ' ') }, by);
}

/** What a version keeps of a page besides its content (History, HT-05). */
export type PageLook = {
  title: string;
  icon: PageIcon | null;
  cover: PageCover | null;
  /** `font`, `smallText`, `textDirection`, `fullWidth` and `coverPosition`. */
  style: Record<string, unknown>;
};

/** The page's look, for History to save with a version; null when there's no such page. */
export async function getPageLook(db: Executor, pageId: string): Promise<PageLook | null> {
  const { rows } = await db.execute<PageLook>(sql`
    SELECT title, icon, cover,
      style || jsonb_build_object('fullWidth', full_width, 'coverPosition', cover_position) AS style
    FROM pages WHERE id = ${isUuid(pageId) ? pageId : null}::uuid`);
  return rows[0] ?? null;
}

/**
 * Puts back a version's look as one change (History's restore, HT-05): style it leaves out goes
 * back to the default, and style it doesn't know is ignored. 400 when something isn't valid, 403
 * when the page is locked, 409 when it or its space is archived, 404 when it's gone or in Trash.
 * Returns the keys for the caller's `page.updated`.
 */
export async function setPageLook(tx: Executor, pageId: string, look: PageLook, by: string) {
  type State = { locked: boolean; archived: boolean; spaceArchived: boolean };
  const { rows } = await tx.execute<State>(sql`
    SELECT p.locked_at IS NOT NULL AS locked, p.archived_at IS NOT NULL AS archived,
      s.archived_at IS NOT NULL AS "spaceArchived"
    FROM pages p JOIN spaces s ON s.id = p.space_id AND s.deleted_at IS NULL
    WHERE p.id = ${isUuid(pageId) ? pageId : null}::uuid AND p.deleted_at IS NULL
    FOR UPDATE OF p`);
  const state = rows[0];
  if (!state) throw notFound();
  if (state.spaceArchived) throw spaceArchived();
  if (state.archived) throw pageArchived();
  if (state.locked) throw pageLocked();
  const { style } = look;
  const changes = updatePageSchema.safeParse({
    title: look.title,
    icon: look.icon ?? null,
    cover: look.cover ?? null,
    font: style.font ?? 'default',
    smallText: style.smallText ?? false,
    textDirection: style.textDirection ?? 'ltr',
    fullWidth: style.fullWidth ?? false,
    coverPosition: style.coverPosition ?? 50,
  });
  if (!changes.success) throw invalid("This version's title, icon, cover or style isn't valid.");
  await updatePage(tx, pageId, changes.data, by);
  return Object.keys(changes.data);
}

/**
 * A Private team space (alias `s`) the person isn't in: only its members and Admins learn its name
 * (decision 0012, point 11).
 */
export function unseenSpace(viewer: Viewer): SQL {
  const admin = [...viewer.memberships.values()].filter((m) => m.isAdmin).map((m) => m.workspaceId);
  return sql`(s.kind = 'private' AND NOT s.workspace_id = ANY(${uuidArray(admin)})
    AND NOT EXISTS (SELECT 1 FROM space_members m
      WHERE m.space_id = s.id AND ${memberOf(viewer)}))`;
}

/** `{ id, name }` of the user in `column`, or null. */
const person = (column: string) =>
  sql.raw(
    `(SELECT json_build_object('id', u.id, 'name', u.name) FROM users u WHERE u.id = ${column})`,
  );

type PageRecord = Omit<PageJson, 'access' | 'ancestors' | (typeof STYLE_KEYS)[number]> & {
  style: Partial<Pick<PageJson, (typeof STYLE_KEYS)[number]>>;
};

/** The page as GET /api/pages/:id sends it, for someone whose level the caller already knows. */
export async function readPage(
  db: Executor,
  viewer: Viewer,
  pageId: string,
  access: AccessLevel,
): Promise<PageJson> {
  const { rows } = await db.execute<PageRecord>(sql`
    SELECT p.id, p.kind, p.is_inline AS "isInline", p.space_id AS "spaceId",
      p.parent_id AS "parentId", p.position, p.title, p.icon, p.cover,
      p.cover_position AS "coverPosition", p.full_width AS "fullWidth", p.style,
      p.inherit_access AS "inheritAccess",
      CASE WHEN ${unseenSpace(viewer)}
        THEN json_build_object('id', s.id, 'name', 'Private space', 'icon', NULL, 'kind', s.kind)
        ELSE json_build_object('id', s.id, 'name', s.name, 'icon', s.icon, 'kind', s.kind)
      END AS space,
      ${person('p.locked_by')} AS "lockedBy", ${iso('p.locked_at')} AS "lockedAt",
      ${person('p.archived_by')} AS "archivedBy", ${iso('p.archived_at')} AS "archivedAt",
      ${person('p.created_by')} AS "createdBy", ${iso('p.created_at')} AS "createdAt",
      ${person('p.updated_by')} AS "updatedBy", ${iso('p.updated_at')} AS "updatedAt",
      ${person('p.deleted_by')} AS "deletedBy", ${iso('p.deleted_at')} AS "deletedAt"
    FROM pages p JOIN spaces s ON s.id = p.space_id
    WHERE p.id = ${isUuid(pageId) ? pageId : null}::uuid`);
  if (!rows[0]) throw notFound();
  const { style, ...page } = rows[0];
  const ancestors = await ancestorsOf(db, viewer, pageId);
  const parent = ancestors.at(-1);
  return {
    ...page,
    // A parent the person can't open stays unnamed, as in the breadcrumbs.
    parentId: parent && 'id' in parent ? page.parentId : null,
    font: style.font ?? 'default',
    smallText: style.smallText ?? false,
    textDirection: style.textDirection ?? 'ltr',
    access,
    ancestors,
  };
}

/** Breadcrumbs, top first. Pages the person can't open become one `{ hidden: true }` per run. */
async function ancestorsOf(db: Executor, viewer: Viewer, pageId: string) {
  const { rows } = await db.execute<{ id: string; title: string; icon: PageIcon | null }>(sql`
    WITH RECURSIVE up AS (
      SELECT parent_id AS id, 1 AS depth FROM pages WHERE id = ${pageId} AND parent_id IS NOT NULL
      UNION ALL
      SELECT p.parent_id, up.depth + 1 FROM up JOIN pages p ON p.id = up.id
      WHERE p.parent_id IS NOT NULL AND up.depth < 1000
    )
    SELECT p.id, p.title, p.icon FROM up JOIN pages p ON p.id = up.id ORDER BY up.depth DESC`);
  const levels = await resolvePages(
    db,
    viewer,
    rows.map((row) => row.id),
  );
  const ancestors: PageAncestor[] = [];
  for (const row of rows) {
    const answer = levels.get(row.id);
    const last = ancestors.at(-1);
    if (answer && !answer.deleted && answer.level !== 'none') ancestors.push(row);
    else if (!last || !('hidden' in last)) ancestors.push({ hidden: true });
  }
  return ancestors;
}
