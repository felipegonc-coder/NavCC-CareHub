// A person's transcript: their courses with scores, dates and current certificates.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { EnrollmentRow } from '../reports/index';
import {
  PersonTranscriptResponseSchema,
  TranscriptRowSchema,
  createCertificateCode,
  transcriptCsv,
  transcriptRows,
  type CertificateRecord,
  type TranscriptRow,
} from './index';

/** True only when each type is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Fictional people and courses only.
const row = (courseId: string, overrides: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  learnerId: 'u-ada',
  learnerName: 'Ada Example',
  groupIds: ['g-voice'],
  courseId,
  courseTitle: `Course ${courseId}`,
  status: 'not_started',
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: true,
  ...overrides,
});

const codeA = createCertificateCode(Uint8Array.from([7, 1, 19, 2, 30, 4, 11, 25, 9, 3, 14]));
const codeB = createCertificateCode(Uint8Array.from([2, 9, 4, 28, 6, 17, 8, 1, 12, 5, 21]));
const codeC = createCertificateCode(Uint8Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]));

const cert = (
  id: string,
  code: string,
  courseId: string,
  completedAt: string,
  expiresOn: string | null,
  learnerId = 'u-ada',
): CertificateRecord => ({
  id,
  code,
  learnerId,
  learnerName: 'Ada Example',
  courseId,
  courseTitle: `Course ${courseId}`,
  courseVersion: 1,
  completedAt,
  issuedOn: completedAt.slice(0, 10),
  expiresOn,
  score: 90,
});

const payments = row('payments', {
  status: 'passed',
  score: 91.6,
  activeSeconds: 1_530,
  attempts: 2,
  startedAt: '2026-01-05T10:00:00.000Z',
  completedAt: '2026-01-06T23:30:00.000Z',
});
const returns = row('returns', {
  status: 'in_progress',
  activeSeconds: 600,
  startedAt: '2026-10-20T09:00:00.000Z',
  lastActivityAt: '2026-10-21T09:00:00.000Z',
  dueDate: '2026-10-25',
});
const privacy = row('privacy', { dueDate: '2026-11-30' });
const certificates = [
  cert('c-old', codeA, 'payments', '2025-01-10T12:00:00.000Z', '2026-01-10'),
  cert('c-new', codeB, 'payments', '2026-01-06T23:30:00.000Z', '2026-11-06'),
  cert('c-other', codeC, 'payments', '2026-02-01T12:00:00.000Z', null, 'u-sam'),
];

describe('transcriptRows', () => {
  it("adds each course's current certificate and sorts newest first", () => {
    const rows = transcriptRows([privacy, payments, returns], certificates, '2026-10-27');
    expect(rows.map((r) => [r.courseId, r.certificate?.id ?? null])).toEqual([
      ['returns', null],
      ['payments', 'c-new'],
      ['privacy', null],
    ]);
    expect(rows[1]?.certificate).toEqual({
      id: 'c-new',
      code: codeB,
      issuedOn: '2026-01-06',
      expiresOn: '2026-11-06',
      status: 'expiring_soon',
    });
    expect(transcriptRows([payments], certificates, '2026-10-27', 7)[0]?.certificate?.status).toBe(
      'valid',
    );
  });

  it('matches the response schema, over the wire', () => {
    const same: Same<z.infer<typeof TranscriptRowSchema>, TranscriptRow> = true;
    expect(same).toBe(true);
    const rows = transcriptRows([payments, returns, privacy], certificates, '2026-10-27');
    const body = JSON.parse(JSON.stringify({ person: { id: 'u-ada', name: 'Ada Example' }, rows }));
    expect(PersonTranscriptResponseSchema.parse(body)).toEqual(body);
    const tampered = { ...body, rows: [{ ...body.rows[0], certificate: { code: 'nope' } }] };
    expect(PersonTranscriptResponseSchema.safeParse(tampered).success).toBe(false);
  });
});

describe('transcriptCsv', () => {
  it('writes one line per course with days in the time zone and overdue days', () => {
    const rows = transcriptRows([payments, returns, privacy], certificates, '2026-10-27');
    const csv = transcriptCsv(rows, '2026-10-27', { timeZone: 'America/Denver' });
    expect(csv.split('\r\n')).toEqual([
      'Course,Status,Score,Time spent (minutes),Attempts,Started,Completed,Due,Days overdue,' +
        'Certificate,Certificate expires',
      'Course returns,In progress,,10,0,2026-10-20,,2026-10-25,2,,',
      `Course payments,Passed,92,26,2,2026-01-05,2026-01-06,,,${codeB},2026-11-06`,
      'Course privacy,Not started,,0,0,,,2026-11-30,,,',
      '',
    ]);
  });

  it('keeps titles safe for spreadsheets and can add a byte order mark', () => {
    const risky = transcriptRows(
      [row('formula', { courseTitle: '=HYPERLINK("x"), then more' })],
      [],
      '2026-10-27',
    );
    const csv = transcriptCsv(risky, '2026-10-27', { bom: true });
    expect(csv.startsWith('\uFEFFCourse,')).toBe(true);
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x""), then more",Not started,,0,0,,,,,,`);
  });
});
