import { compareDays, dueDateCalendarItems, IdSchema, IsoDateSchema } from '@carehub/learning';
import { z } from 'zod';
import { boundAssignmentSources, learnerAssignments, myLearningFor } from './assignments/service';
import { learningToday } from './day';

// Learning's server functions for other lanes: Team tools' Calendar layer and Home
// (docs/learning/api.md). Security (decision 0310): pass the signed-in person's own id
// (`request.user.id`) and workspace, never ids from a query or a body. Each answer holds only that
// person's items, and every `href` is an in-app path that starts with /learning/. "Today" is the
// Learning day, the same for everyone (decision 0317), whatever `timeZone` says.

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
  /** @deprecated Not used: "today" is the Learning day (decision 0317). */
  timeZone?: string;
}): Promise<LearningDueDate[]> => {
  const { userId, workspaceId, from, to } = DueDatesQuerySchema.parse(query);
  const sources = boundAssignmentSources();
  if (!sources || from > to) return [];
  const today = learningToday();
  const { assignments, progress } = await learnerAssignments(sources, workspaceId, today, userId);
  const courseIds = [...new Set(assignments.map((assignment) => assignment.courseId))];
  const courses = await sources.liveCourses(workspaceId, courseIds);
  const statusByCourse = Object.fromEntries(
    progress.map((entry) => [entry.courseId, entry.status]),
  );
  return dueDateCalendarItems(assignments, [...courses.values()], {
    statusByCourse,
    from,
    to,
  }).filter(hasCourseId);
};

/**
 * The person's current courses for Home, most urgent first, at most `limit`: overdue (most late
 * first), then the rest by due date (undated last, in-progress before not started). Finished
 * courses are left out.
 */
export const listMyLearning = async (query: {
  userId: string;
  workspaceId: string;
  limit: number;
  /** @deprecated Not used: "today" is the Learning day (decision 0317). */
  timeZone?: string;
}): Promise<MyLearningItem[]> => {
  const { userId, workspaceId, limit } = MyLearningQuerySchema.parse(query);
  const sources = boundAssignmentSources();
  if (!sources) return [];
  const page = await myLearningFor(sources, { userId, workspaceId }, learningToday());
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
