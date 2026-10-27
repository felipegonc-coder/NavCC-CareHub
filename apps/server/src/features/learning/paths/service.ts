import { randomUUID } from 'node:crypto';
import {
  LEARNING_PATH_FORMAT_VERSION,
  pathPage,
  type CourseStatus,
  type CreatePathRequestSchema,
  type LearningPath,
  type PathCourseInfo,
  type PathPage,
  type PathSummary,
} from '@carehub/learning';
import { and, arrayContains, asc, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Tx } from '../../../db';
import { syncPathAssignments } from '../assignments';
import { canSeeCourse } from '../courses/access';
import { httpError } from '../errors';
import { courseVersions } from '../progress/courses';
import { listCourseStates } from '../progress/service';
import { learningPaths as paths } from './schema';

// Learning paths (docs/learning/api.md): built in Studio (learning.build), opened by anyone in the
// workspace, who sees only the courses of the path they can open. Saving a path keeps its
// assignments in step with its courses (assignments' syncPathAssignments, B4).

/** The signed-in person, in the workspace they are using. */
export type Actor = { userId: string; workspaceId: string };

type PathRow = typeof paths.$inferSelect;
type NewPath = z.output<typeof CreatePathRequestSchema>;

const pathKey = (workspaceId: string, pathId: string) =>
  and(eq(paths.workspaceId, workspaceId), eq(paths.id, pathId));

function pathOf(row: PathRow): LearningPath {
  return {
    formatVersion: LEARNING_PATH_FORMAT_VERSION,
    id: row.id,
    title: row.title,
    ...(row.description !== null && { description: row.description }),
    courseIds: row.courseIds,
    order: row.order,
  };
}

async function findPath(db: Db | Tx, workspaceId: string, pathId: string, lock = false) {
  const query = db.select().from(paths).where(pathKey(workspaceId, pathId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** GET /studio/paths: the workspace's paths, the most recently changed first. */
export async function listPaths(db: Db | Tx, workspaceId: string): Promise<PathSummary[]> {
  const rows = await db
    .select()
    .from(paths)
    .where(eq(paths.workspaceId, workspaceId))
    .orderBy(desc(paths.updatedAt), asc(paths.id));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    courseCount: row.courseIds.length,
    order: row.order,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** POST /studio/paths: a new path, with an id the server picks. Nobody has it assigned yet. */
export async function createPath(db: Db, actor: Actor, input: NewPath): Promise<LearningPath> {
  const [row] = await db
    .insert(paths)
    .values({
      workspaceId: actor.workspaceId,
      id: `path-${randomUUID()}`,
      title: input.title,
      description: input.description ?? null,
      courseIds: input.courseIds,
      order: input.order,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  if (!row) throw new Error('The path was not saved.');
  return pathOf(row);
}

/** GET /studio/paths/:id: the path as saved; 404 when the workspace has none with this id. */
export async function getPath(
  db: Db | Tx,
  workspaceId: string,
  pathId: string,
): Promise<LearningPath> {
  const row = await findPath(db, workspaceId, pathId);
  if (!row) throw httpError(404);
  return pathOf(row);
}

/**
 * The course ids on a path, in path order, or null when the workspace has no such path: what
 * assignments' `pathCourses` source reads (B4, assignments/sources.ts).
 */
export async function pathCourseIds(
  db: Db | Tx,
  workspaceId: string,
  pathId: string,
): Promise<string[] | null> {
  const row = await findPath(db, workspaceId, pathId);
  return row ? row.courseIds : null;
}

/**
 * PUT /studio/paths/:id: saves the whole path (it may still be incomplete; `pathProblems` says
 * what keeps it from being assigned). When its courses changed (added, removed or reordered), its
 * assignments follow in the same transaction. 404 for an unknown path, 400 when the body names
 * another path.
 */
export async function savePath(
  db: Db,
  actor: Actor,
  pathId: string,
  path: LearningPath,
  now = new Date(),
): Promise<LearningPath> {
  if (path.id !== pathId) {
    throw httpError(400, undefined, [{ path: 'id', message: 'Save the path at its own address.' }]);
  }
  const { workspaceId } = actor;
  return db.transaction(async (tx) => {
    const before = await findPath(tx, workspaceId, pathId, true);
    if (!before) throw httpError(404);
    const [row] = await tx
      .update(paths)
      .set({
        title: path.title,
        description: path.description ?? null,
        courseIds: path.courseIds,
        order: path.order,
        updatedBy: actor.userId,
        updatedAt: now,
      })
      .where(pathKey(workspaceId, pathId))
      .returning();
    if (!row) throw httpError(404);
    if (before.courseIds.join(' ') !== row.courseIds.join(' ')) {
      await syncPathAssignments(tx, workspaceId, pathId, row.courseIds);
    }
    return pathOf(row);
  });
}

/**
 * DELETE /studio/paths/:id: removes the path and the assignments made for it (people keep their
 * progress in its courses). 404 for an unknown path.
 */
export async function deletePath(db: Db, workspaceId: string, pathId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx.delete(paths).where(pathKey(workspaceId, pathId)).returning();
    if (removed.length === 0) throw httpError(404);
    await syncPathAssignments(tx, workspaceId, pathId, []);
  });
}

/**
 * After a course is published (`onCoursePublished`, in the publish transaction): the assignments
 * of every path that holds it follow, so a course that just went live reaches the people the
 * path is assigned to.
 */
export async function syncPathsWithCourse(
  tx: Db | Tx,
  workspaceId: string,
  courseId: string,
): Promise<void> {
  const holding = await tx
    .select({ id: paths.id, courseIds: paths.courseIds })
    .from(paths)
    .where(and(eq(paths.workspaceId, workspaceId), arrayContains(paths.courseIds, [courseId])))
    .orderBy(asc(paths.id));
  for (const path of holding) {
    await syncPathAssignments(tx, workspaceId, path.id, path.courseIds);
  }
}

/** The path's courses this person can open: live and visible to them (`canSeeCourse`). */
async function openableCourses(
  db: Db | Tx,
  actor: Actor,
  courseIds: readonly string[],
): Promise<PathCourseInfo[]> {
  const found = await Promise.all(
    courseIds.map(async (courseId): Promise<PathCourseInfo | null> => {
      const live = await courseVersions().live(db, actor.workspaceId, courseId);
      if (!live || !(await canSeeCourse(actor.userId, courseId))) return null;
      const { title, summary, estimatedMinutes } = live.course;
      return { id: courseId, title, summary, estimatedMinutes };
    }),
  );
  return found.filter((course): course is PathCourseInfo => course !== null);
}

/**
 * GET /paths/:id: the path with the courses the person can open, each with their status, and
 * their progress over those courses (`pathPage`). Courses they can't open are left out, so the
 * page never names them. 404 for an unknown path.
 */
export async function getPathPage(db: Db | Tx, actor: Actor, pathId: string): Promise<PathPage> {
  const path = await getPath(db, actor.workspaceId, pathId);
  const courses = await openableCourses(db, actor, path.courseIds);
  const states =
    courses.length === 0
      ? []
      : await listCourseStates(db, {
          workspaceId: actor.workspaceId,
          userIds: [actor.userId],
          courseIds: courses.map((course) => course.id),
        });
  const statusByCourse = new Map<string, CourseStatus>(
    states.map((state) => [state.courseId, state.status]),
  );
  return pathPage(path, courses, statusByCourse);
}
