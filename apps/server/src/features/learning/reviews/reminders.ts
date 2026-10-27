import { compareDays, reviewDueOn, reviewReminderNotice } from '@carehub/learning';
import { and, eq, isNotNull, max, sql } from 'drizzle-orm';
import { users } from '../../auth/schema';
import { sendNotice } from '../../notices';
import { todayIn } from '../assignments/service';
import { canSeeCourse } from '../courses/access';
import { learningCourses as courses, learningCourseVersions as versions } from '../courses/schema';
import type { Db } from '../db';
import { isLearningEnabled } from '../public';
import { learningReviewReminders as reminders } from './schema';

// Review-due reminders (decision 0313): when a live course sets `settings.reviewEveryMonths`, whoever published
// its live version gets a 🔔 notice that many months after publishing, then again every interval until someone
// publishes it again. Archived courses and workspaces with Learning switched off get none. Days are counted in
// the publisher's time zone.

/** The periodic task that sends them, every hour. */
export const REVIEW_REMINDERS_TASK = 'learning.review-reminders';

/**
 * Sends every reminder due by today, at most once per course and due day: each one is claimed in a transaction
 * that rolls back if its notice can't be sent, so it's tried again next time. One failure doesn't stop the
 * others; the first one is thrown at the end. Returns how many it sent.
 */
export async function sendReviewReminders(
  db: Db,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const live = await db
    .select({
      workspaceId: courses.workspaceId,
      courseId: courses.id,
      course: versions.course,
      publishedAt: versions.publishedAt,
      publishedBy: versions.publishedBy,
      timeZone: users.timeZone,
    })
    .from(courses)
    .innerJoin(
      versions,
      and(
        eq(versions.workspaceId, courses.workspaceId),
        eq(versions.courseId, courses.id),
        eq(versions.version, courses.liveVersion),
      ),
    )
    .leftJoin(users, eq(users.id, versions.publishedBy))
    .where(
      and(
        eq(courses.archived, false),
        isNotNull(courses.liveVersion),
        sql`jsonb_typeof(${versions.course} -> 'settings' -> 'reviewEveryMonths') = 'number'`,
      ),
    );
  if (live.length === 0) return 0;

  const lastSent = new Map<string, string>();
  const sentRows = await db
    .select({
      workspaceId: reminders.workspaceId,
      courseId: reminders.courseId,
      sentOn: max(reminders.sentOn),
    })
    .from(reminders)
    .groupBy(reminders.workspaceId, reminders.courseId);
  for (const row of sentRows) {
    if (row.sentOn) lastSent.set(`${row.workspaceId}/${row.courseId}`, row.sentOn);
  }

  const enabled = new Map<string, Promise<boolean>>();
  const learningOn = (workspaceId: string) => {
    let answer = enabled.get(workspaceId);
    if (!answer) enabled.set(workspaceId, (answer = isLearningEnabled(workspaceId)));
    return answer;
  };

  let sent = 0;
  let failure: unknown = null;
  for (const row of live) {
    if (options.signal?.aborted) break;
    const everyMonths = row.course.settings.reviewEveryMonths;
    if (typeof everyMonths !== 'number') continue;
    const { today, timeZone } = todayIn(row.timeZone ?? undefined, now);
    const publishedOn = todayIn(timeZone, row.publishedAt).today;
    const lastSentOn = lastSent.get(`${row.workspaceId}/${row.courseId}`) ?? null;
    const dueOn = reviewDueOn(everyMonths, publishedOn, lastSentOn);
    if (dueOn === null || compareDays(today, dueOn) < 0) continue;
    try {
      if (!(await learningOn(row.workspaceId))) continue;
      const delivered = await db.transaction(async (tx) => {
        const claimed = await tx
          .insert(reminders)
          .values({
            workspaceId: row.workspaceId,
            courseId: row.courseId,
            dueOn,
            sentOn: today,
            userId: row.publishedBy,
          })
          .onConflictDoNothing()
          .returning({ dueOn: reminders.dueOn });
        if (claimed.length === 0) return false;
        const canOpen = await canSeeCourse(row.publishedBy, row.courseId);
        await sendNotice({
          workspaceId: row.workspaceId,
          userId: row.publishedBy,
          kind: 'reminder',
          sender: 'Learning',
          ...reviewReminderNotice({ id: row.courseId, title: row.course.title }, everyMonths, {
            canOpen,
          }),
          groupKey: `learning:review-due:${row.courseId}`,
        });
        return true;
      });
      if (delivered) sent += 1;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) throw failure;
  return sent;
}
