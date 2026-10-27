import {
  addDays,
  expandAssignments,
  isoDateInTimeZone,
  myLearning,
  type Assignment,
  type Course,
  type CourseAssignment,
  type CourseStatus,
  type CreateAssignmentsRequestSchema,
  type LearnerAssignment,
  type LearnerEnrollment,
  type MyLearningEntry,
  type MyLearningItem,
  type MyLearningResponse,
} from '@carehub/learning';
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import type { z } from 'zod';
import { httpError } from '../errors';
import type { AssignmentRow, AssignmentStore, LearnerRow } from './store';

// Assignments (docs/learning/api.md): who must take which course, and by when, worked out per
// person for My learning, the reminders and Team tools' Calendar and Home (public.ts). What other
// areas own comes in through AssignmentSources (sources.ts), so this file also runs on plain data
// in tests.

/** The in-app link to a course's start page. */
export const courseHref = (courseId: string): string =>
  `/learning/courses/${encodeURIComponent(courseId)}`;

/** A person's progress in a course (from the progress area). */
export type CourseProgress = {
  userId: string;
  courseId: string;
  status: CourseStatus;
  percentComplete: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
};

/** The assignment tables, plus what assignments read from other areas. */
export type AssignmentSources = {
  store: AssignmentStore;
  /** The live version of each course that has one. */
  liveCourses(workspaceId: string, courseIds: readonly string[]): Promise<Map<string, Course>>;
  /** The course ids on a learning path, in order, or null when there's no such path. */
  pathCourses(workspaceId: string, pathId: string): Promise<string[] | null>;
  /** Each group's members now; unknown groups are left out. */
  groupMembers(workspaceId: string, groupIds: readonly string[]): Promise<Map<string, string[]>>;
  /** These people's progress in every course they have started. */
  progress(workspaceId: string, userIds: readonly string[]): Promise<CourseProgress[]>;
  /** The workspace setting `learning.enabled`: on unless an admin switched Learning off. */
  learningEnabled(workspaceId: string): Promise<boolean>;
};

let bound: AssignmentSources | null = null;

/** The assignments routes set this while the server runs, so public.ts reads the same data. */
export function bindAssignmentSources(sources: AssignmentSources | null): void {
  bound = sources;
}

/** What `bindAssignmentSources` set, or null when the Learning API isn't running. */
export function boundAssignmentSources(): AssignmentSources | null {
  return bound;
}

/** Today in `timeZone`, or in Care Hub's default zone when that isn't a known IANA zone. */
export function todayIn(
  timeZone: string | undefined,
  now = new Date(),
): { today: string; timeZone: string } {
  const at = now.toISOString();
  if (timeZone) {
    try {
      return { today: isoDateInTimeZone(at, timeZone), timeZone };
    } catch {
      // An unknown zone: fall back to the default below.
    }
  }
  return { today: isoDateInTimeZone(at, DEFAULT_TIME_ZONE), timeZone: DEFAULT_TIME_ZONE };
}

type Actor = { userId: string; workspaceId: string };
type NewAssignments = z.output<typeof CreateAssignmentsRequestSchema>;

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

function assignmentOf(row: AssignmentRow, courses: ReadonlyMap<string, Course>): Assignment {
  return {
    id: row.id,
    courseId: row.courseId,
    courseTitle: courses.get(row.courseId)?.title ?? null,
    pathId: row.pathId,
    people: row.userIds,
    groups: row.groupIds,
    dueDate: row.dueDate,
    dueInDays: row.dueInDays,
    required: row.required,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Assigns a course, or every published course on a path, as one assignment per course. Only
 * published courses can be assigned; a due date can't be before `today`. With `dueInDays`, the
 * people it reaches now start counting today.
 */
export async function createAssignments(
  sources: AssignmentSources,
  actor: Actor,
  input: NewAssignments,
  today: string,
): Promise<Assignment[]> {
  if (input.dueDate !== undefined && input.dueDate < today) {
    throw httpError(400, undefined, [{ path: 'dueDate', message: 'Choose today or a later day.' }]);
  }
  const { workspaceId } = actor;
  const { target } = input;
  const onPath =
    target.type === 'course' ? [target.id] : await sources.pathCourses(workspaceId, target.id);
  if (!onPath) throw httpError(404);
  const live = await sources.liveCourses(workspaceId, unique(onPath));
  const courseIds = unique(onPath).filter((id) => live.has(id));
  if (courseIds.length === 0) {
    if (target.type === 'course') throw httpError(404);
    throw httpError(409, 'None of the courses on this path is published yet. Publish one first.');
  }
  const people = unique(input.people);
  const groups = unique(input.groups);
  const rows = await sources.store.insert(
    courseIds.map((courseId) => ({
      workspaceId,
      courseId,
      pathId: target.type === 'path' ? target.id : null,
      userIds: people,
      groupIds: groups,
      dueDate: input.dueDate ?? null,
      dueInDays: input.dueInDays ?? null,
      required: input.required,
      createdBy: actor.userId,
    })),
  );
  if (input.dueInDays !== undefined) {
    const members = await sources.groupMembers(workspaceId, groups);
    const reached = unique([...people, ...groups.flatMap((id) => members.get(id) ?? [])]);
    await sources.store.addLearners(
      rows.flatMap((row) =>
        reached.map((userId) => ({ assignmentId: row.id, userId, since: today })),
      ),
    );
  }
  return rows.map((row) => assignmentOf(row, live));
}

/** The workspace's assignments, or one course's, oldest first. */
export async function listAssignments(
  sources: AssignmentSources,
  workspaceId: string,
  courseId?: string,
): Promise<Assignment[]> {
  const rows = await sources.store.list(workspaceId, courseId === undefined ? {} : { courseId });
  const live = await sources.liveCourses(workspaceId, unique(rows.map((row) => row.courseId)));
  return rows.map((row) => assignmentOf(row, live));
}

/** Removes an assignment; 404 when the workspace has none with this id. */
export async function deleteAssignment(
  sources: AssignmentSources,
  workspaceId: string,
  id: string,
): Promise<void> {
  if (!(await sources.store.remove(workspaceId, id))) throw httpError(404);
}

/**
 * Every assignment that reaches people now, merged per person and course (`expandAssignments`):
 * their own and their groups' (as the groups are today). With `userId`, only that person's. "Due in
 * N days" counts from the day the person got it; someone seen in one of its groups for the first
 * time gets it `today`.
 */
export async function learnerAssignments(
  sources: AssignmentSources,
  workspaceId: string,
  today: string,
  userId?: string,
): Promise<LearnerAssignment[]> {
  const { store } = sources;
  const rows = await store.list(workspaceId, userId === undefined ? {} : { userId });
  const members = await sources.groupMembers(
    workspaceId,
    unique(rows.flatMap((row) => row.groupIds)),
  );
  const reach = rows.map((row) => {
    const everyone = unique([
      ...row.userIds,
      ...row.groupIds.flatMap((groupId) => members.get(groupId) ?? []),
    ]);
    return {
      row,
      learnerIds: userId === undefined ? everyone : everyone.filter((id) => id === userId),
    };
  });
  const counted = reach.filter(
    ({ row, learnerIds }) => row.dueInDays !== null && learnerIds.length > 0,
  );
  const known = await store.learners(counted.map(({ row }) => row.id));
  const since = new Map(
    known.map((learner) => [`${learner.assignmentId} ${learner.userId}`, learner.since]),
  );
  const firstSeen: LearnerRow[] = [];
  const perLearner: CourseAssignment[] = [];
  for (const { row, learnerIds } of reach) {
    for (const learnerId of learnerIds) {
      let dueDate = row.dueDate ?? undefined;
      if (row.dueInDays !== null) {
        let start = since.get(`${row.id} ${learnerId}`);
        if (start === undefined) {
          start = row.userIds.includes(learnerId) ? todayIn(undefined, row.createdAt).today : today;
          firstSeen.push({ assignmentId: row.id, userId: learnerId, since: start });
        }
        dueDate = addDays(start, row.dueInDays);
      }
      perLearner.push({
        id: row.id,
        courseId: row.courseId,
        learnerIds: [learnerId],
        ...(dueDate !== undefined && { dueDate }),
        required: row.required,
      });
    }
  }
  await store.addLearners(firstSeen);
  return expandAssignments(perLearner, []);
}

type Enrollment = LearnerEnrollment & { percentComplete: number };

function enrollmentOf(progress: CourseProgress): Enrollment {
  const { courseId, status, percentComplete, startedAt, completedAt, lastActivityAt } = progress;
  return {
    courseId,
    status,
    percentComplete,
    ...(startedAt !== null && { startedAt }),
    ...(completedAt !== null && { completedAt }),
    ...(lastActivityAt !== null && { lastActivityAt }),
  };
}

function entryOf(item: MyLearningItem<Course, Enrollment>): MyLearningEntry {
  const { course, enrollment, assignment } = item;
  const percent = Math.round(enrollment?.percentComplete ?? 0);
  return {
    courseId: course.id,
    title: course.title,
    ...(course.summary !== undefined && { summary: course.summary }),
    ...(course.cover !== undefined && { cover: course.cover }),
    ...(course.estimatedMinutes !== undefined && { estimatedMinutes: course.estimatedMinutes }),
    status: item.status,
    progressPercent: Math.min(100, Math.max(0, percent)),
    assigned: assignment !== undefined,
    required: assignment?.required ?? false,
    dueDate: assignment?.dueDate ?? null,
    dueStatus: item.dueStatus,
    lastActivityAt: enrollment?.lastActivityAt ?? null,
    completedAt: enrollment?.completedAt ?? null,
    href: courseHref(course.id),
  };
}

/** One person's My learning (GET /me), from their own assignments and progress only. */
export async function myLearningFor(
  sources: AssignmentSources,
  person: Actor,
  today: string,
  timeZone: string,
): Promise<MyLearningResponse> {
  const { userId, workspaceId } = person;
  const [assignments, progress] = await Promise.all([
    learnerAssignments(sources, workspaceId, today, userId),
    sources.progress(workspaceId, [userId]),
  ]);
  const enrollments = progress.filter((entry) => entry.userId === userId).map(enrollmentOf);
  const courseIds = unique([
    ...assignments.map((assignment) => assignment.courseId),
    ...enrollments.map((enrollment) => enrollment.courseId),
  ]);
  const courses = await sources.liveCourses(workspaceId, courseIds);
  const page = myLearning(enrollments, assignments, [...courses.values()], today, { timeZone });
  return {
    continue: page.continue.map(entryOf),
    assigned: page.assigned.map(entryOf),
    overdue: page.overdue.map(entryOf),
    finished: page.finished.map(entryOf),
  };
}
