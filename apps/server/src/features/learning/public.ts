import {
  compareDays,
  dueDateCalendarItems,
  IdSchema,
  IsoDateSchema,
  type CourseStatus,
} from '@carehub/learning';
import { z } from 'zod';
import {
  boundAssignmentSources,
  learnerAssignments,
  myLearningFor,
  todayIn,
  type AssignmentSources,
} from './assignments/service';

// Learning's server functions for other lanes: Team tools' Calendar layer and Home
// (docs/learning/api.md). Security (decision 0310): pass the signed-in person's own id
// (`request.user.id`) and workspace, never ids from a query or a body. Each answer holds only that
// person's items, and every `href` is an in-app path that starts with /learning/. `timeZone`
// (optional) is the person's profile zone, for what "today" means.

/** A due date on someone's calendar. `dueDate` is a calendar day, `YYYY-MM-DD`. */
export type LearningDueDate = {
  assignmentId: string;
  courseId: string;
  title: string;
  dueDate: string;
  href: string;
};

/** A course on someone's Home. `progressPercent` is 0 to 100. */
export type MyLearningItem = {
  courseId: string;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  progressPercent: number;
  href: string;
};

const Person = {
  userId: z.guid(),
  workspaceId: z.guid(),
  timeZone: z.string().max(100).optional(),
};
const DueDatesQuerySchema = z.object({ ...Person, from: IsoDateSchema, to: IsoDateSchema });
const MyLearningQuerySchema = z.object({ ...Person, limit: z.number().int().min(1).max(100) });

/** Only courses with a valid id, so each `href` is /learning/courses/<id>. */
const hasCourseId = (item: { courseId: string }) => IdSchema.safeParse(item.courseId).success;

/** Undated courses sort after every due date. */
const LAST_DAY = '9999-12-31';

/**
 * Whether Learning is switched on for the workspace: its setting `learning.enabled`, on unless an
 * admin switched it off. Always off while the Learning API isn't running.
 */
export const isLearningEnabled = async (workspaceId: string): Promise<boolean> => {
  const sources = boundAssignmentSources();
  if (!sources || !z.guid().safeParse(workspaceId).success) return false;
  return sources.learningEnabled(workspaceId);
};

/**
 * The person's Learning due dates from `from` to `to` (calendar days, both included): one per
 * course assigned to them with a due date, except the ones they've finished. By date, then title.
 */
export const listLearningDueDates = async (query: {
  userId: string;
  workspaceId: string;
  from: string;
  to: string;
  timeZone?: string;
}): Promise<LearningDueDate[]> => {
  const { userId, workspaceId, from, to, timeZone } = DueDatesQuerySchema.parse(query);
  const sources = boundAssignmentSources();
  if (!sources || from > to) return [];
  const assignments = await learnerAssignments(
    sources,
    workspaceId,
    todayIn(timeZone).today,
    userId,
  );
  const courseIds = [...new Set(assignments.map((assignment) => assignment.courseId))];
  const [courses, statusByCourse] = await Promise.all([
    sources.liveCourses(workspaceId, courseIds),
    statusesOf(sources, workspaceId, userId),
  ]);
  return dueDateCalendarItems(assignments, [...courses.values()], {
    statusByCourse,
    from,
    to,
  }).filter(hasCourseId);
};

async function statusesOf(
  sources: AssignmentSources,
  workspaceId: string,
  userId: string,
): Promise<Record<string, CourseStatus>> {
  const progress = await sources.progress(workspaceId, [userId]);
  const mine = progress.filter((entry) => entry.userId === userId);
  return Object.fromEntries(mine.map((entry) => [entry.courseId, entry.status]));
}

/**
 * The person's current courses for Home, most urgent first, at most `limit`: overdue (most late
 * first), then the rest by due date (undated last, in-progress before not started). Finished
 * courses are left out.
 */
export const listMyLearning = async (query: {
  userId: string;
  workspaceId: string;
  limit: number;
  timeZone?: string;
}): Promise<MyLearningItem[]> => {
  const { userId, workspaceId, limit, timeZone } = MyLearningQuerySchema.parse(query);
  const sources = boundAssignmentSources();
  if (!sources) return [];
  const zone = todayIn(timeZone);
  const page = await myLearningFor(sources, { userId, workspaceId }, zone.today, zone.timeZone);
  const dueDay = (entry: { dueDate: string | null }) => entry.dueDate ?? LAST_DAY;
  const upcoming = [...page.continue, ...page.assigned].sort((a, b) =>
    compareDays(dueDay(a), dueDay(b)),
  );
  const current = [...page.overdue, ...upcoming];
  return current
    .filter(hasCourseId)
    .slice(0, limit)
    .map((entry) => ({
      courseId: entry.courseId,
      title: entry.title,
      dueDate: entry.dueDate,
      overdue: entry.dueStatus === 'overdue',
      progressPercent: entry.progressPercent,
      href: entry.href,
    }));
};
