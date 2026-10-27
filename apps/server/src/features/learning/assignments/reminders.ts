import {
  assignmentNotice,
  remindersDue,
  type ReminderKind,
  type SentReminder,
} from '@carehub/learning';
import type { SendNoticeInput } from '../../notices';
import { learnerAssignments, todayIn, type AssignmentSources } from './service';

// The reminders job (docs/learning/api.md, Jobs). Every hour from 8:00 to 20:00 in Care Hub's time
// zone, each person with a course assigned gets the reminders `remindersDue` says are due today, as
// notices in their 🔔 Care Hub chat (never an email), unless Learning is off in the workspace. Each
// reminder is logged just before its notice goes out, so none is sent twice, even when a run stops
// half way.

/** The periodic task (features/jobs): one run at a time across the servers. */
export const REMINDERS_TASK = 'learning.reminders';
export const REMINDERS_EVERY_MS = 60 * 60 * 1000;

/** Reminders go out from 8:00 until 20:00, Care Hub time. */
const SENDING_HOURS = { from: 8, until: 20 };

/** A reminder that went out (learning_reminders_sent); `sentOn` is the day, Care Hub time. */
export type SentReminderRow = {
  workspaceId: string;
  userId: string;
  courseId: string;
  kind: ReminderKind;
  sentOn: string;
};

/** The assignments, plus what the job reads and writes besides them. */
export type ReminderSources = AssignmentSources & {
  /** Every workspace with an assignment. */
  workspaces(): Promise<string[]>;
  /** The reminders these people got in the workspace. */
  sentReminders(workspaceId: string, userIds: readonly string[]): Promise<SentReminderRow[]>;
  /** Logs a reminder; false when it was logged already. */
  logReminder(row: SentReminderRow): Promise<boolean>;
  /** Whether the person can open the course now: only then does the notice name it. */
  canOpen(workspaceId: string, userId: string, courseId: string): Promise<boolean>;
  /** Team tools' `sendNotice`. */
  sendNotice(notice: SendNoticeInput): Promise<unknown>;
};

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

function hourIn(timeZone: string, now: Date): number {
  const format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
  return Number(format.format(now));
}

/** Sends the reminders due at `now` and returns how many went out (none outside sending hours). */
export async function sendReminders(
  sources: ReminderSources,
  now = new Date(),
  signal?: AbortSignal,
): Promise<number> {
  const { today, timeZone } = todayIn(undefined, now);
  const hour = hourIn(timeZone, now);
  if (hour < SENDING_HOURS.from || hour >= SENDING_HOURS.until) return 0;
  let sent = 0;
  for (const workspaceId of await sources.workspaces()) {
    if (signal?.aborted) break;
    if (!(await sources.learningEnabled(workspaceId))) continue;
    sent += await remindWorkspace(sources, workspaceId, today, signal);
  }
  return sent;
}

async function remindWorkspace(
  sources: ReminderSources,
  workspaceId: string,
  today: string,
  signal: AbortSignal | undefined,
): Promise<number> {
  const { assignments, progress, madeAt } = await learnerAssignments(sources, workspaceId, today);
  const learnerIds = unique(assignments.map((assignment) => assignment.learnerId));
  const [courses, log] = await Promise.all([
    sources.liveCourses(workspaceId, unique(assignments.map((assignment) => assignment.courseId))),
    sources.sentReminders(workspaceId, learnerIds),
  ]);
  const key = (row: { userId: string; courseId: string }) => `${row.userId} ${row.courseId}`;
  const statuses = new Map(progress.map((entry) => [key(entry), entry.status]));
  const sentLog = new Map<string, SentReminder[]>();
  for (const row of log) {
    sentLog.set(key(row), [...(sentLog.get(key(row)) ?? []), { kind: row.kind, on: row.sentOn }]);
  }
  let sent = 0;
  for (const assignment of assignments) {
    const course = courses.get(assignment.courseId);
    if (!course || signal?.aborted) continue;
    const { learnerId: userId, dueDate, required } = assignment;
    const id = key({ userId, courseId: course.id });
    const status = statuses.get(id) ?? 'not_started';
    // Reminders sent before these assignments were made were for earlier ones (say, before a
    // re-certification), so they don't count.
    const since = firstDayOf(assignment.assignmentIds, madeAt);
    const sentForThese = (sentLog.get(id) ?? []).filter((reminder) => reminder.on >= since);
    for (const kind of remindersDue({ dueDate, required, status }, sentForThese, today)) {
      const row = { workspaceId, userId, courseId: course.id, kind, sentOn: today };
      if (!(await sources.logReminder(row))) continue;
      const canOpen = await sources.canOpen(workspaceId, userId, course.id);
      const notice = assignmentNotice(kind, course, { today, dueDate, canOpen });
      await sources.sendNotice({
        workspaceId,
        userId,
        kind: 'reminder',
        sender: 'Learning',
        ...notice,
      });
      sent += 1;
    }
  }
  return sent;
}

/** The day, in Care Hub's time zone, the first of these assignments was made. */
function firstDayOf(ids: readonly string[], madeAt: ReadonlyMap<string, Date>): string {
  const times = ids.flatMap((id) => madeAt.get(id)?.getTime() ?? []);
  return times.length === 0 ? '' : todayIn(undefined, new Date(Math.min(...times))).today;
}
