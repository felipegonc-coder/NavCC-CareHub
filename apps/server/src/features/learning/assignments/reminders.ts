import {
  assignmentNotice,
  remindersDue,
  type ReminderKind,
  type SentReminder,
} from '@carehub/learning';
import type { SendNoticeInput } from '../../notices';
import {
  learnerAssignments,
  todayIn,
  type AssignmentSources,
  type LearnerAssignments,
} from './service';

// The reminders job (docs/learning/api.md, Jobs). Every hour from 8:00 to 20:00 in Care Hub's time
// zone, each person with a course assigned gets the reminders `remindersDue` says are due today, as
// notices in their 🔔 Care Hub chat (never an email), unless Learning is off in the workspace. Each
// reminder is logged just before its notice goes out, so none is sent twice, even when a run stops
// half way; when a notice can't go out, its reminder comes off the log again and the next run sends
// it. The "assigned" notice also goes out the moment an assignment is made (`sendAssignedNotices`);
// the job sends it to people who join a group later, and to anyone that one missed.

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
  /** Takes a reminder off the log because its notice didn't go out, so the next run sends it. */
  unlogReminder(row: SentReminderRow): Promise<void>;
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

/** How a run went: the notices that went out, and why the others didn't. */
type Outcome = { sent: number; failed: unknown[] };

/** How many notices went out; throws when some didn't, after the rest were sent. */
function sentOrThrow({ sent, failed }: Outcome): number {
  if (failed.length === 0) return sent;
  const tried = sent + failed.length;
  throw new AggregateError(
    failed,
    `Learning: ${failed.length} of ${tried} notices did not go out; the next run tries again.`,
  );
}

/**
 * Sends the reminders due at `now` and returns how many went out (none outside sending hours).
 * Throws once the run is over when some notices didn't go out.
 */
export async function sendReminders(
  sources: ReminderSources,
  now = new Date(),
  signal?: AbortSignal,
): Promise<number> {
  const { today, timeZone } = todayIn(undefined, now);
  const hour = hourIn(timeZone, now);
  if (hour < SENDING_HOURS.from || hour >= SENDING_HOURS.until) return 0;
  const outcome: Outcome = { sent: 0, failed: [] };
  for (const workspaceId of await sources.workspaces()) {
    if (signal?.aborted) break;
    if (!(await sources.learningEnabled(workspaceId))) continue;
    await remindWorkspace(sources, workspaceId, today, outcome, signal);
  }
  return sentOrThrow(outcome);
}

/**
 * Sends the "assigned" notices for assignments just made, by id, at once and at any hour, to the
 * people they reach now. Returns how many went out; the job never sends these again. Throws when
 * some didn't go out: the job sends those.
 */
export async function sendAssignedNotices(
  sources: ReminderSources,
  workspaceId: string,
  assignmentIds: readonly string[],
  now = new Date(),
): Promise<number> {
  if (assignmentIds.length === 0) return 0;
  if (!(await sources.learningEnabled(workspaceId))) return 0;
  const made = new Set(assignmentIds);
  const outcome: Outcome = { sent: 0, failed: [] };
  await remindWorkspace(sources, workspaceId, todayIn(undefined, now).today, outcome, undefined, {
    kinds: ['assigned'],
    only: (assignment) => assignment.assignmentIds.some((id) => made.has(id)),
  });
  return sentOrThrow(outcome);
}

/** Which merged assignments, and which kinds of reminder, a run is about (all when left out). */
type Scope = {
  kinds?: readonly ReminderKind[];
  only?: (assignment: LearnerAssignments['assignments'][number]) => boolean;
};

/** Sends one workspace's reminders, counting them in `outcome`. */
async function remindWorkspace(
  sources: ReminderSources,
  workspaceId: string,
  today: string,
  outcome: Outcome,
  signal: AbortSignal | undefined,
  scope: Scope = {},
): Promise<void> {
  const all = await learnerAssignments(sources, workspaceId, today);
  const { progress, madeAt } = all;
  const assignments = scope.only ? all.assignments.filter(scope.only) : all.assignments;
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
      if (scope.kinds && !scope.kinds.includes(kind)) continue;
      const row = { workspaceId, userId, courseId: course.id, kind, sentOn: today };
      if (!(await sources.logReminder(row))) continue;
      try {
        const canOpen = await sources.canOpen(workspaceId, userId, course.id);
        const notice = assignmentNotice(kind, course, { today, dueDate, canOpen });
        await sources.sendNotice({
          workspaceId,
          userId,
          kind: 'reminder',
          sender: 'Learning',
          ...notice,
        });
        outcome.sent += 1;
      } catch (error) {
        // The others still go out; this one waits for the next run.
        await sources.unlogReminder(row);
        outcome.failed.push(error);
      }
    }
  }
}

/** The day, in Care Hub's time zone, the first of these assignments was made. */
function firstDayOf(ids: readonly string[], madeAt: ReadonlyMap<string, Date>): string {
  const times = ids.flatMap((id) => madeAt.get(id)?.getTime() ?? []);
  return times.length === 0 ? '' : todayIn(undefined, new Date(Math.min(...times))).today;
}
