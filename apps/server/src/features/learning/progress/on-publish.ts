import { courseUpdateFor, type CourseUpdateNotice, type PublishNotify } from '@carehub/learning';
import { and, eq, ne } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { sendNotice } from '../../notices';
import { issueCertificate } from '../certificates/service';
import { canSeeCourse } from '../courses/access';
import { courseVersions, type PublishedCourse } from './courses';
import { learningProgressChanges as changes, learningProgress as progress } from './schema';
import { newRunOf, progressKey, runEvents, stateOf, summaryOf, type ProgressRow } from './store';

/**
 * A new live version, just saved (same transaction). `note` is the author's message to
 * learners.
 */
export type CoursePublished = {
  workspaceId: string;
  courseId: string;
  version: number;
  notify: PublishNotify;
  note?: string;
};

/** Carries the run on in the new version: its events count again against that version. */
async function move(
  db: Db | Tx,
  row: ProgressRow,
  live: PublishedCourse,
  now: Date,
): Promise<void> {
  const state = stateOf(live.course, row, await runEvents(db, row));
  await db
    .update(progress)
    .set({ ...summaryOf(state), version: live.version, updatedAt: now })
    .where(progressKey(row));
  // The new version may need less, so the run can finish here.
  const { workspaceId, learnerId } = row;
  const { course, version } = live;
  await issueCertificate(db, { workspaceId, learnerId, course, version, finish: state });
}

/** Starts the run over on the new version (a retake). The old run's events are kept. */
async function restart(
  db: Db | Tx,
  row: ProgressRow,
  published: CoursePublished,
  now: Date,
): Promise<void> {
  const next = newRunOf(row, published.version, now);
  await db.update(progress).set(next).where(progressKey(row));
  await db.insert(changes).values({
    workspaceId: row.workspaceId,
    learnerId: row.learnerId,
    courseId: row.courseId,
    kind: 'retake',
    run: next.run,
    changedBy: null,
    note: published.note || null,
    changedAt: now,
  });
}

async function tell(row: ProgressRow, notice: CourseUpdateNotice): Promise<void> {
  try {
    await sendNotice({
      workspaceId: row.workspaceId,
      userId: row.learnerId,
      sender: 'Learning',
      ...notice,
      groupKey: `learning:course-updated:${row.courseId}`,
    });
  } catch {
    // A notice that can't be sent doesn't stop the publish; the course page shows the change.
  }
}

/**
 * Publish hook (decision 0311): what a new live version means for each learner's run, from
 * courseUpdateFor and the run's saved state. `move` measures the run's events against the new
 * version, `restart` begins a new run on it (old events kept, a completion marked by hand
 * cleared) and `keep` leaves the run on its version. Notices go only to people who can see the
 * course (decision 0313). It runs in the publish transaction, so a failed publish changes nobody.
 */
export const onCoursePublished = async (db: Db | Tx, published: CoursePublished): Promise<void> => {
  const { workspaceId, courseId, version, notify, note } = published;
  // Read through the transaction, so the version just saved is there (see courses.ts).
  const live = await courseVersions().version(db, workspaceId, courseId, version);
  if (!live) return;
  const rows: ProgressRow[] = await db
    .select()
    .from(progress)
    .where(
      and(
        eq(progress.workspaceId, workspaceId),
        eq(progress.courseId, courseId),
        ne(progress.version, version),
      ),
    )
    // Locked until the publish commits, so a batch of events arriving meanwhile waits for it.
    .for('update');
  const course = { id: courseId, title: live.course.title, note };
  const now = new Date();
  for (const row of rows) {
    const update = courseUpdateFor(notify, row, course);
    if (update.run === 'move') await move(db, row, live, now);
    if (update.run === 'restart') await restart(db, row, published, now);
    if (update.notice && (await canSeeCourse(row.learnerId, courseId))) {
      await tell(row, update.notice);
    }
  }
};
