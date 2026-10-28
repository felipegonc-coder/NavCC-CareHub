import {
  addDays,
  certificateNotice,
  certificateNoticeDue,
  recertificationDueDate,
  type CertificateNoticeKind,
  type CertificateRecord,
  type IsoDate,
  type SentCertificateNotice,
} from '@carehub/learning';
import { and, asc, eq, inArray, isNotNull, isNull, lte, not, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { users } from '../../auth/schema';
import { sendNotice } from '../../notices';
import { assignForRecertification, type Recertification } from '../assignments';
import { canSeeCourse } from '../courses/access';
import { startRecertificationRun } from '../progress/service';
import { isLearningEnabled } from '../public';
import {
  learningCertificateNotices as notices,
  learningCertificates as certificates,
} from './schema';
import { dayIn, recordOf, type CertificateRow } from './service';

// The certificate jobs (docs/learning/api.md, Jobs): re-certification, which assigns a course
// again before its certificate expires, and the expiry heads-up, which tells each holder when their
// current certificate is about to expire and when it has. Each happens once per certificate.

/** How many days before the expiry day the heads-up goes out. */
export const CERTIFICATE_HEADS_UP_DAYS = 30;

/** The name of the periodic task that runs the certificate jobs (`runCertificateJobs`). */
export const CERTIFICATE_NOTICES_TASK = 'learning.certificate-notices';

// Only the certificate from a learner's latest finish of a course counts: a retake replaced the
// older ones (currentCertificates in packages/learning).
const isCurrent = sql`NOT EXISTS (
  SELECT 1 FROM learning_certificates AS newer
  WHERE newer.workspace_id = ${certificates.workspaceId}
    AND newer.learner_id = ${certificates.learnerId}
    AND newer.course_id = ${certificates.courseId}
    AND newer.completed_at > ${certificates.completedAt})`;

const wasSent = (kind: CertificateNoticeKind) => sql`EXISTS (
  SELECT 1 FROM learning_certificate_notices AS sent
  WHERE sent.certificate_id = ${certificates.id} AND sent.kind = ${kind})`;

type Holder = CertificateRecord & { workspaceId: string };

/** Records the notice and sends it, in one transaction: false when it was already recorded. */
async function notify(db: Db, cert: Holder, kind: CertificateNoticeKind, today: IsoDate) {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(notices)
      .values({ certificateId: cert.id, kind, sentOn: today })
      .onConflictDoNothing()
      .returning({ kind: notices.kind });
    if (claimed.length === 0) return false;
    const canOpen = await canSeeCourse(cert.learnerId, cert.courseId);
    const notice = certificateNotice(kind, cert, { today, canOpen });
    await sendNotice({
      workspaceId: cert.workspaceId,
      userId: cert.learnerId,
      kind: kind === 'expired' ? 'alert' : 'reminder',
      sender: 'Learning',
      ...notice,
      groupKey: `learning:certificate-${kind}:${cert.id}`,
    });
    return true;
  });
}

/**
 * Sends the expiry notices due at `now`, for each learner's current certificate of each course:
 * "expiring soon" from CERTIFICATE_HEADS_UP_DAYS days before the expiry day, "expired" from that
 * day on (`certificateNoticeDue`), each once, on the holder's own calendar day. The text names
 * the course only when the holder can open it (decision 0313). Skips workspaces with Learning
 * off. A notice that fails is tried again on the next run and doesn't stop the others; the first
 * failure is thrown at the end. Returns how many notices went out.
 */
export async function sendCertificateNotices(db: Db, now = new Date()): Promise<number> {
  const utcToday = dayIn(now, 'UTC');
  // A day of slack either way: the holder's day can be ahead of UTC.
  const soon = addDays(utcToday, CERTIFICATE_HEADS_UP_DAYS + 1);
  const rows = await db
    .select({ certificate: certificates, timeZone: users.timeZone })
    .from(certificates)
    .leftJoin(users, eq(users.id, certificates.learnerId))
    .where(
      and(
        isNotNull(certificates.expiresOn),
        lte(certificates.expiresOn, soon),
        isCurrent,
        not(wasSent('expired')),
        or(lte(certificates.expiresOn, addDays(utcToday, 1)), not(wasSent('expiring_soon'))),
      ),
    )
    .orderBy(asc(certificates.expiresOn), asc(certificates.id));
  if (rows.length === 0) return 0;

  const sent = new Map<string, SentCertificateNotice[]>();
  const sentRows = await db
    .select()
    .from(notices)
    .where(
      inArray(
        notices.certificateId,
        rows.map(({ certificate }) => certificate.id),
      ),
    );
  for (const row of sentRows) {
    sent.set(row.certificateId, [
      ...(sent.get(row.certificateId) ?? []),
      { kind: row.kind, on: row.sentOn },
    ]);
  }

  const enabled = new Map<string, Promise<boolean>>();
  const learningOn = (workspaceId: string) => {
    if (!enabled.has(workspaceId)) enabled.set(workspaceId, isLearningEnabled(workspaceId));
    return enabled.get(workspaceId) ?? Promise.resolve(false);
  };

  let count = 0;
  let failure: unknown = null;
  for (const { certificate, timeZone } of rows) {
    const today = dayIn(now, timeZone);
    const cert = { ...recordOf(certificate), workspaceId: certificate.workspaceId };
    const kind = certificateNoticeDue(
      cert,
      sent.get(cert.id) ?? [],
      today,
      CERTIFICATE_HEADS_UP_DAYS,
    );
    if (kind === null) continue;
    try {
      if (!(await learningOn(cert.workspaceId))) continue;
      if (await notify(db, cert, kind, today)) count += 1;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) throw failure;
  return count;
}

/** Assigns a course again for re-certification: assignments' `assignForRecertification`. */
export type Reassign = (tx: Tx, input: Recertification) => Promise<string | null>;

/** Assigns the course again and starts the holder's next run, in one transaction, once. */
async function renew(
  db: Db,
  cert: CertificateRow,
  when: { today: IsoDate; dueDate: IsoDate; now: Date },
  reassign: Reassign,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select({ id: certificates.id })
      .from(certificates)
      .where(and(eq(certificates.id, cert.id), isNull(certificates.reassignedOn)))
      .for('update');
    if (!open) return false;
    const { workspaceId, learnerId, courseId } = cert;
    const input = { workspaceId, courseId, userId: learnerId, dueDate: when.dueDate };
    if ((await reassign(tx, input)) === null) return false;
    const note = `Re-certification: the certificate runs out on ${cert.expiresOn ?? when.dueDate}.`;
    await startRecertificationRun(tx, { workspaceId, learnerId, courseId }, note, when.now);
    await tx
      .update(certificates)
      .set({ reassignedOn: when.today })
      .where(eq(certificates.id, cert.id));
    return true;
  });
}

/**
 * Re-certification (PRD, phase 3): from CERTIFICATE_HEADS_UP_DAYS days before a learner's current
 * certificate of a course expires, on their own calendar day, assigns the course to them again,
 * due on the expiry day, or today once that has passed (`recertificationDueDate`). In the same
 * transaction their next run starts (`startRecertificationRun`), so the assignment stays open
 * until they finish the course again. Once per certificate (`reassigned_on`). While nothing can be
 * assigned (Learning off, the course not live) the certificate waits for the next run. A failure
 * doesn't stop the others; the first is thrown at the end. Returns how many were reassigned.
 */
export async function reassignExpiringCertificates(
  db: Db,
  now = new Date(),
  reassign: Reassign = assignForRecertification,
): Promise<number> {
  // A day of slack, as for the notices: the holder's day can be ahead of UTC.
  const soon = addDays(dayIn(now, 'UTC'), CERTIFICATE_HEADS_UP_DAYS + 1);
  const rows = await db
    .select({ certificate: certificates, timeZone: users.timeZone })
    .from(certificates)
    .leftJoin(users, eq(users.id, certificates.learnerId))
    .where(
      and(
        isNotNull(certificates.expiresOn),
        lte(certificates.expiresOn, soon),
        isNull(certificates.reassignedOn),
        isCurrent,
      ),
    )
    .orderBy(asc(certificates.expiresOn), asc(certificates.id));

  let count = 0;
  let failure: unknown = null;
  for (const { certificate, timeZone } of rows) {
    const today = dayIn(now, timeZone);
    const dueDate = recertificationDueDate(certificate, today, CERTIFICATE_HEADS_UP_DAYS);
    if (dueDate === null) continue;
    try {
      if (await renew(db, certificate, { today, dueDate, now }, reassign)) count += 1;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) throw failure;
  return count;
}

/**
 * The hourly certificate jobs: re-certification first, so an assignment is there when its
 * heads-up goes out, then the expiry notices. Each runs even when the other fails; the first
 * failure is thrown at the end.
 */
export async function runCertificateJobs(db: Db, now = new Date()): Promise<void> {
  const failures: unknown[] = [];
  await reassignExpiringCertificates(db, now).catch((error: unknown) => failures.push(error));
  await sendCertificateNotices(db, now).catch((error: unknown) => failures.push(error));
  if (failures.length > 0) throw failures[0];
}
