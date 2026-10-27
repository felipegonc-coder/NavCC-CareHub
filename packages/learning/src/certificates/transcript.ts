import type { CourseStatus, IsoDate, IsoDateTime } from '../format/index';
import {
  personTranscript,
  toCsv,
  type CsvColumn,
  type EnrollmentRow,
  type ReportOptions,
} from '../reports/index';
import { daysBetween, isoDateInTimeZone } from '../util/index';
import type { TranscriptCertificate } from './api';
import { certificateStatus } from './expiry';
import { currentCertificates, type CertificateRecord } from './issue';

/** One course in a person's transcript: their enrollment row and current certificate, if any. */
export type TranscriptRow = EnrollmentRow & { certificate: TranscriptCertificate | null };

const key = (learnerId: string, courseId: string) => JSON.stringify([learnerId, courseId]);

/**
 * A person's transcript: each enrollment row with the learner's current certificate for that
 * course (`currentCertificates`, with its status on `today`), in `personTranscript` order (newest
 * first, courses not started last). Certificates for other people or courses are left out.
 */
export function transcriptRows(
  rows: readonly EnrollmentRow[],
  certificates: readonly CertificateRecord[],
  today: IsoDate,
  headsUpDays = 30,
): TranscriptRow[] {
  const current = new Map(
    currentCertificates(certificates).map((cert) => [key(cert.learnerId, cert.courseId), cert]),
  );
  return personTranscript(
    rows.map((row) => {
      const cert = current.get(key(row.learnerId, row.courseId));
      const certificate = cert
        ? {
            id: cert.id,
            code: cert.code,
            issuedOn: cert.issuedOn,
            expiresOn: cert.expiresOn,
            status: certificateStatus(cert, today, headsUpDays),
          }
        : null;
      return { ...row, certificate };
    }),
  );
}

const STATUS_LABELS: Record<CourseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

/**
 * A transcript as CSV, one line per course in the order given: Course, Status, Score, Time spent
 * (minutes), Attempts, Started, Completed, Due, Days overdue, Certificate (its code) and
 * Certificate expires. Started and Completed are calendar days in `options.timeZone` (default
 * UTC). Days overdue is empty unless the course is unfinished and past its due date on `today`.
 */
export function transcriptCsv(
  rows: readonly TranscriptRow[],
  today: IsoDate,
  options: ReportOptions & { bom?: boolean } = {},
): string {
  const day = (at: IsoDateTime | undefined) =>
    at === undefined ? null : isoDateInTimeZone(at, options.timeZone ?? 'UTC');
  const overdue = (row: TranscriptRow) => {
    const finished = row.status === 'completed' || row.status === 'passed';
    const days = row.dueDate === undefined || finished ? 0 : daysBetween(row.dueDate, today);
    return days > 0 ? days : null;
  };
  const columns: CsvColumn<TranscriptRow>[] = [
    { header: 'Course', value: (row) => row.courseTitle },
    { header: 'Status', value: (row) => STATUS_LABELS[row.status] },
    { header: 'Score', value: (row) => (row.score === null ? null : Math.round(row.score)) },
    { header: 'Time spent (minutes)', value: (row) => Math.round(row.activeSeconds / 60) },
    { header: 'Attempts', value: (row) => row.attempts },
    { header: 'Started', value: (row) => day(row.startedAt) },
    { header: 'Completed', value: (row) => day(row.completedAt) },
    { header: 'Due', value: (row) => row.dueDate },
    { header: 'Days overdue', value: overdue },
    { header: 'Certificate', value: (row) => row.certificate?.code },
    { header: 'Certificate expires', value: (row) => row.certificate?.expiresOn },
  ];
  return toCsv(columns, rows, options.bom ? { bom: true } : {});
}
