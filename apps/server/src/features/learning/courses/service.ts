import {
  checkPublishable,
  createCourse,
  parseCourse,
  type Course,
  type CourseState,
  type CourseSummary,
  type CourseVersion,
  type CreateCourseRequest,
  type LiveCourse,
  type PublishNotify,
  type StudioCourse,
} from '@carehub/learning';
import { and, desc, eq } from 'drizzle-orm';
import { resolveBankDraws } from '../banks/publish';
import type { Db, Tx } from '../db';
import { httpError } from '../errors';
import { onCoursePublished } from '../progress/on-publish';
import { learningCourses as courses, learningCourseVersions as versions } from './schema';

// Courses (docs/learning/api.md): Studio drafts with a revision check, publishing as numbered live versions,
// versions and roll back, and the live version for learners. Routes check permissions
// first; every function here stays inside the actor's workspace.

/** Who is acting, and in which workspace. */
export type Actor = { userId: string; workspaceId: string };

type CourseRow = typeof courses.$inferSelect;
type CourseChanges = Partial<typeof courses.$inferInsert>;

const CHANGED_MEANWHILE = 'This course changed a moment ago. Reload to see the latest version.';

const courseKey = (workspaceId: string, id: string) =>
  and(eq(courses.workspaceId, workspaceId), eq(courses.id, id));

function stateOf(row: CourseRow): CourseState {
  if (row.liveVersion === null) return 'draft';
  return row.revision === row.publishedRevision ? 'live' : 'changed';
}

function summaryOf(row: CourseRow): CourseSummary {
  const { draft } = row;
  return {
    id: row.id,
    title: draft.title,
    type: draft.type,
    state: stateOf(row),
    version: row.liveVersion,
    updatedAt: row.updatedAt.toISOString(),
    archived: row.archived,
    listed: draft.settings.catalog.listed,
  };
}

const studioCourse = (row: CourseRow): StudioCourse => ({
  course: row.draft,
  revision: row.revision,
  liveVersion: row.liveVersion,
});

async function findCourse(db: Db | Tx, actor: Actor, id: string): Promise<CourseRow> {
  const [row] = await db.select().from(courses).where(courseKey(actor.workspaceId, id));
  if (!row) throw httpError(404);
  return row;
}

async function insertDraft(db: Db | Tx, actor: Actor, draft: Course): Promise<CourseRow> {
  const [row] = await db
    .insert(courses)
    .values({ workspaceId: actor.workspaceId, id: draft.id, draft, createdBy: actor.userId })
    .returning();
  if (!row) throw new Error('The new course was not saved.');
  return row;
}

/** Studio's list, most recently changed first. */
export async function listStudioCourses(
  db: Db | Tx,
  actor: Actor,
  options: { archived: boolean },
): Promise<CourseSummary[]> {
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.workspaceId, actor.workspaceId), eq(courses.archived, options.archived)))
    .orderBy(desc(courses.updatedAt));
  return rows.map(summaryOf);
}

/** A new, blank draft with its type's preset. */
export async function createStudioCourse(
  db: Db | Tx,
  actor: Actor,
  input: CreateCourseRequest,
): Promise<StudioCourse> {
  const draft = createCourse({ type: input.type, title: input.title?.trim() ?? '' });
  return studioCourse(await insertDraft(db, actor, draft));
}

export async function getStudioCourse(
  db: Db | Tx,
  actor: Actor,
  id: string,
): Promise<StudioCourse> {
  return studioCourse(await findCourse(db, actor, id));
}

/** Saves the draft unless someone saved since `revision`. Drafts need the schema only, not the publish checks. */
export async function saveDraft(
  db: Db | Tx,
  actor: Actor,
  id: string,
  input: { course: unknown; revision: number },
): Promise<{ revision: number }> {
  const parsed = parseCourse(input.course);
  if (!parsed.ok) throw httpError(400, undefined, parsed.issues);
  if (parsed.course.id !== id) {
    throw httpError(400, undefined, [
      { path: 'id', message: "This doesn't match the course's address." },
    ]);
  }
  const row = await findCourse(db, actor, id);
  if (row.revision !== input.revision) {
    throw httpError(
      409,
      'Someone else saved this course since you opened it. Reload to see their changes.',
    );
  }
  const revision = row.revision + 1;
  const saved = await db
    .update(courses)
    .set({ draft: parsed.course, revision, updatedAt: new Date() })
    .where(and(courseKey(actor.workspaceId, id), eq(courses.revision, row.revision)))
    .returning({ id: courses.id });
  if (saved.length === 0) throw httpError(409, CHANGED_MEANWHILE);
  return { revision };
}

type PublishOptions = {
  notify: PublishNotify;
  note?: string | undefined;
  rolledBackFrom?: number;
  /** What else changes on the course row, in the same transaction. */
  changes: CourseChanges;
};

/** Writes the next version and makes it live, unless the course changed since `row` was read. */
async function publish(
  db: Db,
  actor: Actor,
  row: CourseRow,
  course: Course,
  options: PublishOptions,
): Promise<{ version: number }> {
  const version = (row.liveVersion ?? 0) + 1;
  const { notify, note, rolledBackFrom } = options;
  const at = new Date();
  await db.transaction(async (tx) => {
    // Two people publishing at once both try this version number; the second one gets a 409.
    const added = await tx
      .insert(versions)
      .values({
        workspaceId: actor.workspaceId,
        courseId: row.id,
        version,
        course,
        publishedAt: at,
        publishedBy: actor.userId,
        notify,
        note: note || null,
        rolledBackFrom: rolledBackFrom ?? null,
      })
      .onConflictDoNothing()
      .returning({ version: versions.version });
    if (added.length === 0) throw httpError(409, CHANGED_MEANWHILE);
    const moved = await tx
      .update(courses)
      .set({ ...options.changes, liveVersion: version, updatedAt: at })
      .where(and(courseKey(actor.workspaceId, row.id), eq(courses.revision, row.revision)))
      .returning({ id: courses.id });
    if (moved.length === 0) throw httpError(409, CHANGED_MEANWHILE);
    // Progress (B3) updates learners in the same transaction, so a version and its effects stand or fall together.
    await onCoursePublished(tx, {
      workspaceId: actor.workspaceId,
      courseId: row.id,
      version,
      notify,
      ...(note ? { note } : {}),
    });
  });
  return { version };
}

/** Publishes the saved draft as the next version, after copying in bank questions and passing every check. */
export async function publishCourse(
  db: Db | Tx,
  actor: Actor,
  id: string,
  input: { notify: PublishNotify; note?: string | undefined },
): Promise<{ version: number }> {
  const row = await findCourse(db, actor, id);
  const course = await resolveBankDraws(db, row.draft);
  const problems = checkPublishable(course);
  if (problems.length > 0) {
    const count = problems.length === 1 ? 'this problem' : `these ${problems.length} problems`;
    throw httpError(422, `Fix ${count} before publishing.`, problems);
  }
  return publish(db, actor, row, course, {
    ...input,
    changes: { publishedRevision: row.revision },
  });
}

export async function listVersions(
  db: Db | Tx,
  actor: Actor,
  id: string,
): Promise<CourseVersion[]> {
  await findCourse(db, actor, id);
  const rows = await db
    .select()
    .from(versions)
    .where(and(eq(versions.workspaceId, actor.workspaceId), eq(versions.courseId, id)))
    .orderBy(desc(versions.version));
  return rows.map(({ version, publishedAt, publishedBy, notify, note, rolledBackFrom }) => ({
    version,
    publishedAt: publishedAt.toISOString(),
    publishedBy,
    notify,
    ...(note ? { note } : {}),
    ...(rolledBackFrom ? { rolledBackFrom } : {}),
  }));
}

async function findVersion(db: Db | Tx, workspaceId: string, courseId: string, version: number) {
  const [row] = await db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.workspaceId, workspaceId),
        eq(versions.courseId, courseId),
        eq(versions.version, version),
      ),
    );
  return row;
}

/**
 * Publishes a copy of an earlier version as the next one. The draft follows it when it had no unpublished
 * edits; otherwise those edits stay in the draft, which then shows as changed.
 */
export async function rollBack(
  db: Db | Tx,
  actor: Actor,
  id: string,
  input: { version: number; notify: PublishNotify; note?: string | undefined },
): Promise<{ version: number }> {
  const row = await findCourse(db, actor, id);
  if (input.version === row.liveVersion) throw httpError(409, 'That version is already live.');
  const target = await findVersion(db, actor.workspaceId, id, input.version);
  if (!target) throw httpError(404);
  const revision = row.revision + 1;
  const changes: CourseChanges =
    stateOf(row) === 'live'
      ? { draft: target.course, revision, publishedRevision: revision }
      : { publishedRevision: null };
  return publish(db, actor, row, target.course, {
    notify: input.notify,
    note: input.note,
    rolledBackFrom: input.version,
    changes,
  });
}

/** The live version of a course, for learners and the other Learning areas. Null when it was never published. */
export async function getLiveCourse(
  db: Db | Tx,
  workspaceId: string,
  courseId: string,
): Promise<LiveCourse | null> {
  const [row] = await db
    .select({ course: versions.course, version: versions.version })
    .from(courses)
    .innerJoin(
      versions,
      and(
        eq(versions.workspaceId, courses.workspaceId),
        eq(versions.courseId, courses.id),
        eq(versions.version, courses.liveVersion),
      ),
    )
    .where(courseKey(workspaceId, courseId));
  return row ?? null;
}

/** Adds a course with its own id and publishes it, unless the workspace has it already (seed data). */
export async function seedCourse(db: Db, actor: Actor, course: Course): Promise<boolean> {
  const [row] = await db
    .insert(courses)
    .values({
      workspaceId: actor.workspaceId,
      id: course.id,
      draft: course,
      createdBy: actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return false;
  await publish(db, actor, row, course, { notify: 'none', changes: { publishedRevision: 1 } });
  return true;
}
