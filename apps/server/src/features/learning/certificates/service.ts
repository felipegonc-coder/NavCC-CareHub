import { randomBytes, randomUUID } from 'node:crypto';
import {
  CERTIFICATE_CODE_RANDOM_BYTES,
  LIMITS,
  certificateDue,
  createCertificateCode,
  earnsCertificate,
  isoDateInTimeZone,
  newCertificate,
  withCertificateStatus,
  type Certificate,
  type CertificateFinish,
  type CertificateListQuery,
  type CertificateRecord,
  type Course,
  type IsoDate,
} from '@carehub/learning';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { users } from '../../auth/schema';
import type { Viewer } from '../auth';
import type { Db, Tx } from '../db';
import { httpError } from '../errors';
import { learningCertificates as certificates } from './schema';

// Certificates (docs/learning/api.md): the server issues one when a learner's finish earns it, and
// the learner and people with learning.analytics read them. Every query stays inside the viewer's
// workspace. Days (issued, expires, today) are read in the learner's own time zone.

/** A learning_certificates row. */
export type CertificateRow = typeof certificates.$inferSelect;

/** A finish to issue a certificate for, on the course version the learner's run is pinned to. */
export type CertificateIssue = {
  workspaceId: string;
  learnerId: string;
  course: Pick<Course, 'id' | 'title' | 'settings'>;
  version: number;
  finish: CertificateFinish;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` can name a row: certificate and people ids are UUIDs. */
export const isUuid = (id: string): boolean => UUID.test(id);

/** `timeZone` when it is a known IANA name, otherwise UTC. */
export function usableTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** The calendar day of `now` in `timeZone` (UTC when unknown). */
export const dayIn = (now: Date, timeZone: string | null | undefined): IsoDate =>
  isoDateInTimeZone(now.toISOString(), usableTimeZone(timeZone));

/** A stored certificate, as the shared logic describes it (no status). */
export function recordOf(row: CertificateRow): CertificateRecord {
  return {
    id: row.id,
    code: row.code,
    learnerId: row.learnerId,
    learnerName: row.learnerName,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    courseVersion: row.courseVersion,
    completedAt: row.completedAt.toISOString(),
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    score: row.score,
  };
}

async function learnerOf(db: Db | Tx, userId: string) {
  const [user] = await db
    .select({ name: users.name, timeZone: users.timeZone })
    .from(users)
    .where(eq(users.id, userId));
  return { name: (user?.name ?? '').slice(0, LIMITS.title), timeZone: user?.timeZone };
}

/**
 * Issues the certificate a finish earns, in the transaction that saves the learner's progress.
 * Null when the course has certificates off, the learner failed, or this finish already has one:
 * each finish (its `completedAt`) gets at most one, and a retake is a new finish with its own.
 */
export async function issueCertificate(
  tx: Db | Tx,
  input: CertificateIssue,
): Promise<CertificateRecord | null> {
  const { workspaceId, learnerId, course, version, finish } = input;
  if (finish.completedAt === null || !earnsCertificate(course, finish.status)) return null;
  const issued = await tx
    .select({ courseId: certificates.courseId, completedAt: certificates.completedAt })
    .from(certificates)
    .where(
      and(
        eq(certificates.workspaceId, workspaceId),
        eq(certificates.learnerId, learnerId),
        eq(certificates.courseId, course.id),
      ),
    );
  const finishes = issued.map((row) => ({
    learnerId,
    courseId: row.courseId,
    completedAt: row.completedAt.toISOString(),
  }));
  if (!certificateDue(course, learnerId, finish, finishes)) return null;
  const learner = await learnerOf(tx, learnerId);
  const record = newCertificate({
    id: randomUUID(),
    code: createCertificateCode(randomBytes(CERTIFICATE_CODE_RANDOM_BYTES)),
    course,
    courseVersion: version,
    learner: { id: learnerId, name: learner.name },
    finish,
    timeZone: usableTimeZone(learner.timeZone),
  });
  const saved = await tx
    .insert(certificates)
    .values({ ...record, workspaceId, completedAt: new Date(record.completedAt) })
    .onConflictDoNothing({
      target: [
        certificates.workspaceId,
        certificates.learnerId,
        certificates.courseId,
        certificates.completedAt,
      ],
    })
    .returning({ id: certificates.id });
  return saved.length > 0 ? record : null;
}

/** Certificates matching `where`, newest finish first, each with its status on the holder's day. */
async function findCertificates(
  db: Db | Tx,
  where: SQL | undefined,
  now: Date,
): Promise<Certificate[]> {
  const rows = await db
    .select({ certificate: certificates, timeZone: users.timeZone })
    .from(certificates)
    .leftJoin(users, eq(users.id, certificates.learnerId))
    .where(where)
    .orderBy(desc(certificates.completedAt), desc(certificates.id));
  return rows.map(({ certificate, timeZone }) =>
    withCertificateStatus(recordOf(certificate), dayIn(now, timeZone)),
  );
}

/**
 * GET /certificates, newest first: the viewer's own, or `personId`'s with learning.analytics (403
 * without it). `code` looks a certificate up to verify it: people with learning.analytics find
 * anyone's in the workspace, others only their own, so someone else's code comes back empty, as
 * an unknown one does. `courseId` narrows any of these.
 */
export async function listCertificates(
  db: Db | Tx,
  viewer: Viewer,
  query: CertificateListQuery,
  now = new Date(),
): Promise<Certificate[]> {
  const analyst = viewer.can('learning.analytics');
  const anyone = query.code !== undefined && analyst && query.personId === undefined;
  const personId = anyone ? undefined : (query.personId ?? viewer.userId);
  if (personId !== undefined && personId !== viewer.userId && !analyst) throw httpError(403);
  if (personId !== undefined && !isUuid(personId)) return [];
  const where = and(
    eq(certificates.workspaceId, viewer.workspaceId),
    personId === undefined ? undefined : eq(certificates.learnerId, personId),
    query.courseId === undefined ? undefined : eq(certificates.courseId, query.courseId),
    query.code === undefined ? undefined : eq(certificates.code, query.code),
  );
  return findCertificates(db, where, now);
}

/** GET /certificates/:id: the viewer's own, or anyone's with learning.analytics; 404 otherwise. */
export async function getCertificate(
  db: Db | Tx,
  viewer: Viewer,
  id: string,
  now = new Date(),
): Promise<Certificate> {
  if (!isUuid(id)) throw httpError(404);
  const where = and(
    eq(certificates.workspaceId, viewer.workspaceId),
    eq(certificates.id, id),
    viewer.can('learning.analytics') ? undefined : eq(certificates.learnerId, viewer.userId),
  );
  const [certificate] = await findCertificates(db, where, now);
  if (!certificate) throw httpError(404);
  return certificate;
}
