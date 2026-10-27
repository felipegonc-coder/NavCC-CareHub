import {
  LIMITS,
  type EnrollmentRow,
  type IsoDate,
  type LearnerAssignment,
} from '@carehub/learning';
import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { users } from '../../auth/schema';
import { learnerAssignments } from '../assignments/service';
import { postgresSources } from '../assignments/sources';
import { listCourseStates, type CourseStateRow } from '../progress/service';

// Report rows (docs/learning/api.md): one EnrollmentRow per person and course, read by every
// report. A person is enrolled in a course when it is assigned to them now, directly or through a
// group, or when they have started it. Groups and managers come from core's workspace members
// (0007 section 4.3, Oct 29): until those are on main, there are no groups and nobody manages
// anyone.

/** A group reports can show, with its members now. */
export type ReportGroup = { id: string; name: string; memberIds: readonly string[] };

/** Which rows to read. */
export type RowsQuery = {
  workspaceId: string;
  /** Today in the Learning day zone (decision 0317): "due in N days" counts from it. */
  today: IsoDate;
  /** Only these people; everyone enrolled when left out. */
  userIds?: readonly string[];
  /** Only these courses; every course when left out. */
  courseIds?: readonly string[];
};

/** What `rowsOf` puts together. */
export type RowParts = {
  /** One per person and course (`learnerAssignments`). */
  assignments: readonly LearnerAssignment[];
  /** Progress per person and course (`listCourseStates`). */
  states: readonly CourseStateRow[];
  /** Course titles by id. Courses without one have no live version and are left out. */
  titles: ReadonlyMap<string, string>;
  /** People's names by id. */
  names: ReadonlyMap<string, string>;
  groups: readonly ReportGroup[];
};

type Enrollment = {
  learnerId: string;
  courseId: string;
  assignment?: LearnerAssignment;
  state?: CourseStateRow;
};

const keyOf = (learnerId: string, courseId: string) => JSON.stringify([learnerId, courseId]);
const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

/**
 * One row per person and course in `assignments` or `states`, in that order: progress from the
 * state (not started without one), due date and required from the assignment (optional without
 * one), and the ids of the groups the person is in.
 */
export function rowsOf(parts: RowParts): EnrollmentRow[] {
  const enrollments = new Map<string, Enrollment>();
  const enrollmentOf = (learnerId: string, courseId: string): Enrollment => {
    const key = keyOf(learnerId, courseId);
    const known = enrollments.get(key);
    if (known) return known;
    const added: Enrollment = { learnerId, courseId };
    enrollments.set(key, added);
    return added;
  };
  for (const assignment of parts.assignments) {
    enrollmentOf(assignment.learnerId, assignment.courseId).assignment = assignment;
  }
  for (const state of parts.states) enrollmentOf(state.userId, state.courseId).state = state;

  const groupIdsOf = (learnerId: string) =>
    parts.groups.filter((group) => group.memberIds.includes(learnerId)).map((group) => group.id);
  return [...enrollments.values()].flatMap(({ learnerId, courseId, assignment, state }) => {
    const courseTitle = parts.titles.get(courseId);
    if (courseTitle === undefined) return [];
    const row: EnrollmentRow = {
      learnerId,
      learnerName: (parts.names.get(learnerId) ?? '').slice(0, LIMITS.title),
      groupIds: groupIdsOf(learnerId),
      courseId,
      courseTitle: courseTitle.slice(0, LIMITS.title),
      status: state?.status ?? 'not_started',
      score: state?.score ?? null,
      activeSeconds: state?.activeSeconds ?? 0,
      attempts: state?.attempts ?? 0,
      ...(state?.startedAt != null && { startedAt: state.startedAt }),
      ...(state?.completedAt != null && { completedAt: state.completedAt }),
      ...(state?.lastActivityAt != null && { lastActivityAt: state.lastActivityAt }),
      ...(assignment?.dueDate !== undefined && { dueDate: assignment.dueDate }),
      ...(state?.lastLessonId != null && { lastLessonId: state.lastLessonId }),
      required: assignment?.required ?? false,
    };
    return [row];
  });
}

/** The workspace's groups, with their members now. None until core's groups are on main. */
export const reportGroups: (
  db: Db | Tx,
  workspaceId: string,
) => Promise<ReportGroup[]> = async () => [];

/**
 * The people who report to `managerId` (core's `listReports`). Nobody until core's managers are
 * on main.
 */
export const reportsOf: (
  db: Db | Tx,
  workspaceId: string,
  managerId: string,
) => Promise<string[]> = async () => [];

/** People's names by id, for the ones found. */
export async function namesOf(
  db: Db | Tx,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const found = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return new Map(found.map((user) => [user.id, user.name]));
}

/**
 * The enrollment rows of `query`'s people and courses in the workspace (`rowsOf`): their
 * assignments as they reach them today (`learnerAssignments`), their progress, the courses' live
 * titles, their names and their groups (`reportGroups`).
 */
export async function enrollmentRows(db: Db | Tx, query: RowsQuery): Promise<EnrollmentRow[]> {
  const { workspaceId, today, userIds, courseIds } = query;
  if (userIds?.length === 0 || courseIds?.length === 0) return [];
  const sources = postgresSources(db);
  const [onlyUser] = userIds?.length === 1 ? userIds : [];
  const reached = await learnerAssignments(sources, workspaceId, today, onlyUser);
  const wanted = (learnerId: string, courseId: string) =>
    (userIds === undefined || userIds.includes(learnerId)) &&
    (courseIds === undefined || courseIds.includes(courseId));
  const assignments = reached.assignments.filter((a) => wanted(a.learnerId, a.courseId));
  const states = await listCourseStates(db, {
    workspaceId,
    ...(userIds !== undefined && { userIds }),
    ...(courseIds !== undefined && { courseIds }),
  });
  const people = unique([...assignments.map((a) => a.learnerId), ...states.map((s) => s.userId)]);
  const courses = unique([...assignments.map((a) => a.courseId), ...states.map((s) => s.courseId)]);
  const live = await sources.liveCourses(workspaceId, courses);
  return rowsOf({
    assignments,
    states,
    titles: new Map([...live].map(([id, course]) => [id, course.title])),
    names: await namesOf(db, people),
    groups: await reportGroups(db, workspaceId),
  });
}
