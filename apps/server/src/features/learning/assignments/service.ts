import {
  addDays,
  expandAssignments,
  IsoDateSchema,
  isoDateInTimeZone,
  myLearning,
  PersonIdSchema,
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
import type { AssignmentRow, AssignmentStore, LearnerRow, NewAssignmentRow } from './store';

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
  /** The latest completed or passed finish of any run before the current one. */
  previousFinishedAt: string | null;
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

/**
 * The rows one assignment made: one per course, sharing `createdAt` and `createdBy` (a path gives
 * several).
 */
const batchOf = (row: AssignmentRow) => `${row.createdAt.toISOString()} ${row.createdBy}`;

/**
 * Removes an assignment; 404 when the workspace has none with this id. A course assigned with a
 * path goes with the rest of that path assignment, so `syncPath` can't bring it back.
 */
export async function deleteAssignment(
  sources: AssignmentSources,
  workspaceId: string,
  id: string,
): Promise<void> {
  const { store } = sources;
  const removed = await store.remove(workspaceId, id);
  if (!removed) throw httpError(404);
  if (removed.pathId === null) return;
  for (const row of await store.list(workspaceId, { pathId: removed.pathId })) {
    if (batchOf(row) === batchOf(removed)) await store.remove(workspaceId, row.id);
  }
}

/**
 * Keeps a path's assignments in step with its courses: each assignment made for the path gets a row
 * for every published course in `courseIds` and loses the rows of courses no longer there (progress
 * stays). One whose courses all left the path goes. For an added course, people named in a "due in
 * N days" assignment start counting `today`, and group members when first seen.
 */
export async function syncPath(
  sources: AssignmentSources,
  workspaceId: string,
  pathId: string,
  courseIds: readonly string[],
  today: string,
): Promise<void> {
  const { store } = sources;
  const rows = await store.list(workspaceId, { pathId });
  if (rows.length === 0) return;
  const live = await sources.liveCourses(workspaceId, unique(courseIds));
  const wanted = unique(courseIds).filter((courseId) => live.has(courseId));
  const batches = new Map<string, AssignmentRow[]>();
  for (const row of rows) batches.set(batchOf(row), [...(batches.get(batchOf(row)) ?? []), row]);
  const added: NewAssignmentRow[] = [];
  for (const batch of batches.values()) {
    for (const row of batch) {
      if (!wanted.includes(row.courseId)) await store.remove(workspaceId, row.id);
    }
    const [first] = batch;
    if (!first) continue;
    const { userIds, groupIds, dueDate, dueInDays, required, createdBy, createdAt } = first;
    const fields = { workspaceId, pathId, userIds, groupIds, dueDate, dueInDays, required };
    for (const courseId of wanted) {
      if (batch.some((row) => row.courseId === courseId)) continue;
      added.push({ ...fields, courseId, createdBy, createdAt });
    }
  }
  const inserted = await store.insert(added);
  await store.addLearners(
    inserted.flatMap((row) =>
      row.dueInDays === null
        ? []
        : row.userIds.map((userId) => ({ assignmentId: row.id, userId, since: today })),
    ),
  );
}

/**
 * Who made the assignments Care Hub makes itself when a certificate runs out: no one, so the nil
 * UUID (`created_by` has no foreign key).
 */
export const RECERTIFICATION_ASSIGNER = '00000000-0000-0000-0000-000000000000';

/** A course to take again by the day a person's certificate runs out. */
export type Recertification = {
  workspaceId: string;
  courseId: string;
  userId: string;
  /** YYYY-MM-DD. */
  dueDate: string;
};

/**
 * Assigns a course again to one person, required and due on `dueDate`, made by
 * RECERTIFICATION_ASSIGNER. Returns the assignment's id: the earlier one when this person already
 * has it for that course and day, or null (nothing assigned) when Learning is off or the course
 * isn't published.
 */
export async function assignRecertification(
  sources: AssignmentSources,
  input: Recertification,
): Promise<string | null> {
  const { workspaceId, courseId } = input;
  const userId = PersonIdSchema.parse(input.userId);
  const dueDate = IsoDateSchema.parse(input.dueDate);
  if (!(await sources.learningEnabled(workspaceId))) return null;
  if (!(await sources.liveCourses(workspaceId, [courseId])).has(courseId)) return null;
  const made = await sources.store.list(workspaceId, { courseId, userId });
  const earlier = made.find(
    (row) =>
      row.createdBy === RECERTIFICATION_ASSIGNER &&
      row.dueDate === dueDate &&
      row.userIds.includes(userId),
  );
  if (earlier) return earlier.id;
  const [row] = await sources.store.insert([
    {
      workspaceId,
      courseId,
      pathId: null,
      userIds: [userId],
      groupIds: [],
      dueDate,
      dueInDays: null,
      required: true,
      createdBy: RECERTIFICATION_ASSIGNER,
    },
  ]);
  return row?.id ?? null;
}

/**
 * Merged assignments (`learnerAssignments`), the progress of the people they reach, and when each
 * assignment was made, by id.
 */
export type LearnerAssignments = {
  assignments: LearnerAssignment[];
  progress: CourseProgress[];
  madeAt: ReadonlyMap<string, Date>;
};

/**
 * Every assignment that reaches people now, merged per person and course (`expandAssignments`):
 * their own and their groups' (as the groups are today), with those people's progress. With
 * `userId`, only that person's. "Due in N days" counts from the day the person got it; someone seen
 * in one of its groups for the first time gets it `today`. An assignment the person finished in an
 * earlier run after it was made stays done and is left out, so a new run (retake, reset or
 * re-certification) doesn't bring back its due date.
 */
export async function learnerAssignments(
  sources: AssignmentSources,
  workspaceId: string,
  today: string,
  userId?: string,
): Promise<LearnerAssignments> {
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
  const people = userId === undefined ? unique(reach.flatMap((r) => r.learnerIds)) : [userId];
  const progress =
    people.length === 0
      ? []
      : (await sources.progress(workspaceId, people)).filter((p) => people.includes(p.userId));
  const progressOf = new Map(progress.map((p) => [`${p.userId} ${p.courseId}`, p]));
  const settled = (row: AssignmentRow, learnerId: string) => {
    const before = progressOf.get(`${learnerId} ${row.courseId}`)?.previousFinishedAt;
    return typeof before === 'string' && Date.parse(before) >= row.createdAt.getTime();
  };
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
      if (settled(row, learnerId)) continue;
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
  const madeAt = new Map(rows.map((row) => [row.id, row.createdAt]));
  return { assignments: expandAssignments(perLearner, []), progress, madeAt };
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
  const { assignments, progress } = await learnerAssignments(sources, workspaceId, today, userId);
  const enrollments = progress.map(enrollmentOf);
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
