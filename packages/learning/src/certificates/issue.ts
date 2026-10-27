import type { Course, CourseStatus, Id, IsoDate, IsoDateTime } from '../format/index';
import { isoDateInTimeZone } from '../util/index';
import type { Certificate } from './api';
import { isCertificateCodeWellFormed } from './code';
import { certificateExpiry, certificateStatus } from './expiry';

/**
 * A certificate as the server stores it. Its status depends on the day, so it is added when the
 * certificate is read (`withCertificateStatus`).
 */
export type CertificateRecord = Omit<Certificate, 'status'>;

/** What issuing reads from a learner's state for the course. `LearnerCourseState` fits. */
export type CertificateFinish = {
  status: CourseStatus;
  completedAt: IsoDateTime | null;
  score: number | null;
};

type FinishKey = Pick<CertificateRecord, 'learnerId' | 'courseId' | 'completedAt'>;

const instant = (at: IsoDateTime): number => Date.parse(at);

/**
 * Whether finishing with `status` earns a certificate: the course has certificates switched on and
 * the learner passed or completed it. A failed course never does.
 */
export function earnsCertificate(course: Pick<Course, 'settings'>, status: CourseStatus): boolean {
  return course.settings.certificate.enabled && (status === 'passed' || status === 'completed');
}

/**
 * Whether a learner's finish needs a new certificate: it earns one, and none of `issued` (their
 * certificates, or all of them) comes from the same finish of this course, meaning the same
 * `completedAt`. A retake or re-certification is a new finish with its own certificate, and asking
 * again about the same finish says no, so a certificate is never issued twice.
 */
export function certificateDue(
  course: Pick<Course, 'id' | 'settings'>,
  learnerId: Id,
  finish: CertificateFinish,
  issued: readonly FinishKey[],
): boolean {
  const { completedAt } = finish;
  if (completedAt === null || !earnsCertificate(course, finish.status)) return false;
  return !issued.some(
    (cert) =>
      cert.learnerId === learnerId &&
      cert.courseId === course.id &&
      instant(cert.completedAt) === instant(completedAt),
  );
}

/**
 * A new certificate for a finish. It is issued on the calendar day of `completedAt` in `timeZone`
 * (an IANA name, default UTC) and expires `settings.certificate.validForMonths` months later, or
 * never. Throws a RangeError when the finish has no `completedAt` or `code` isn't a well-formed
 * certificate code (make one with `createCertificateCode`).
 */
export function newCertificate(input: {
  id: Id;
  code: string;
  course: Pick<Course, 'id' | 'title' | 'settings'>;
  courseVersion: number;
  learner: { id: Id; name: string };
  finish: CertificateFinish;
  timeZone?: string;
}): CertificateRecord {
  const { id, code, course, courseVersion, learner, finish } = input;
  if (finish.completedAt === null) throw new RangeError('A certificate needs a finished course');
  if (!isCertificateCodeWellFormed(code)) throw new RangeError('Not a certificate code');
  const issuedOn = isoDateInTimeZone(finish.completedAt, input.timeZone ?? 'UTC');
  return {
    id,
    code,
    learnerId: learner.id,
    learnerName: learner.name,
    courseId: course.id,
    courseTitle: course.title,
    courseVersion,
    completedAt: finish.completedAt,
    issuedOn,
    expiresOn: certificateExpiry(issuedOn, course.settings.certificate.validForMonths),
    score: finish.score,
  };
}

/** The certificate as the API sends it on `today`, with its status (`certificateStatus`). */
export function withCertificateStatus(
  record: CertificateRecord,
  today: IsoDate,
  headsUpDays = 30,
): Certificate {
  return { ...record, status: certificateStatus(record, today, headsUpDays) };
}

/**
 * Each learner's current certificate per course: the one from their latest finish. Older ones were
 * replaced by a retake or re-certification and get no expiry notices. Keeps the input order.
 */
export function currentCertificates<C extends FinishKey>(certificates: readonly C[]): C[] {
  const latest = new Map<string, C>();
  for (const cert of certificates) {
    const key = JSON.stringify([cert.learnerId, cert.courseId]);
    const kept = latest.get(key);
    if (!kept || instant(cert.completedAt) > instant(kept.completedAt)) latest.set(key, cert);
  }
  const current = new Set(latest.values());
  return certificates.filter((cert) => current.has(cert));
}
