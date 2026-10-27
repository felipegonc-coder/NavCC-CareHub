import { describe, expect, it } from 'vitest';
import type { Course, CourseStatus } from '../format/index';
import {
  CertificateListQuerySchema,
  CertificateListResponseSchema,
  CertificateSchema,
  certificateDue,
  certificateNotice,
  certificateNoticeDue,
  createCertificateCode,
  currentCertificates,
  earnsCertificate,
  newCertificate,
  recertificationDueDate,
  withCertificateStatus,
  type CertificateRecord,
  type SentCertificateNotice,
} from './index';

// Fictional course and people only.
type IssuingCourse = Pick<Course, 'id' | 'title' | 'settings'>;

function course(certificate: Course['settings']['certificate']): IssuingCourse {
  return {
    id: 'safe-payments',
    title: 'Safe payments on the phone',
    settings: {
      lessonOrder: 'sequential',
      completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: false },
      catalog: { listed: true },
      certificate,
    },
  };
}

const yearly = course({ enabled: true, validForMonths: 12 });
const forever = course({ enabled: true });
const noCertificate = course({ enabled: false });
const code = createCertificateCode(Uint8Array.from([7, 1, 19, 2, 30, 4, 11, 25, 9, 3, 14]));
const otherCode = createCertificateCode(Uint8Array.from([2, 9, 4, 28, 6, 17, 8, 1, 12, 5, 21]));
const ada = { id: 'u-ada', name: 'Ada Example' };
const passed = { status: 'passed' as const, completedAt: '2026-10-27T15:00:00.000Z', score: 92 };

function issue(overrides: Partial<Parameters<typeof newCertificate>[0]> = {}): CertificateRecord {
  return newCertificate({
    id: 'cert-1',
    code,
    course: yearly,
    courseVersion: 3,
    learner: ada,
    finish: passed,
    ...overrides,
  });
}

describe('earnsCertificate', () => {
  it('is true for passed and completed courses that have certificates on', () => {
    const statuses: CourseStatus[] = [
      'not_started',
      'in_progress',
      'completed',
      'passed',
      'failed',
    ];
    expect(statuses.filter((status) => earnsCertificate(yearly, status))).toEqual([
      'completed',
      'passed',
    ]);
    expect(statuses.some((status) => earnsCertificate(noCertificate, status))).toBe(false);
  });
});

describe('certificateDue', () => {
  it('is due once per finish', () => {
    expect(certificateDue(yearly, ada.id, passed, [])).toBe(true);
    const issued = [issue()];
    expect(certificateDue(yearly, ada.id, passed, issued)).toBe(false);
    // The same instant written another way is the same finish.
    const sameFinish = { ...passed, completedAt: '2026-10-27T17:00:00+02:00' };
    expect(certificateDue(yearly, ada.id, sameFinish, issued)).toBe(false);
  });

  it('is due again for a later finish (a retake or re-certification)', () => {
    const retake = { ...passed, completedAt: '2027-10-01T09:30:00.000Z' };
    expect(certificateDue(yearly, ada.id, retake, [issue()])).toBe(true);
  });

  it("ignores other people's and other courses' certificates", () => {
    const issued = [
      { ...issue(), learnerId: 'u-bo' },
      { ...issue(), courseId: 'other-course' },
    ];
    expect(certificateDue(yearly, ada.id, passed, issued)).toBe(true);
  });

  it('is not due without a finish or without certificates on the course', () => {
    expect(
      certificateDue(yearly, ada.id, { status: 'in_progress', completedAt: null, score: null }, []),
    ).toBe(false);
    expect(certificateDue(yearly, ada.id, { ...passed, status: 'failed' }, [])).toBe(false);
    expect(certificateDue(noCertificate, ada.id, passed, [])).toBe(false);
  });
});

describe('newCertificate', () => {
  it('copies the finish and expires validForMonths after the issue day', () => {
    expect(issue()).toEqual({
      id: 'cert-1',
      code,
      learnerId: 'u-ada',
      learnerName: 'Ada Example',
      courseId: 'safe-payments',
      courseTitle: 'Safe payments on the phone',
      courseVersion: 3,
      completedAt: '2026-10-27T15:00:00.000Z',
      issuedOn: '2026-10-27',
      expiresOn: '2027-10-27',
      score: 92,
    });
  });

  it('is issued on the calendar day of the finish in the workspace time zone', () => {
    const lateEvening = { ...passed, completedAt: '2026-10-27T03:00:00.000Z' };
    const cert = issue({ finish: lateEvening, timeZone: 'America/Denver' });
    expect(cert.issuedOn).toBe('2026-10-26');
    expect(cert.expiresOn).toBe('2027-10-26');
  });

  it('never expires without validForMonths and keeps a null score', () => {
    const completed = {
      status: 'completed' as const,
      completedAt: passed.completedAt,
      score: null,
    };
    const cert = issue({ course: forever, finish: completed });
    expect(cert.expiresOn).toBeNull();
    expect(cert.score).toBeNull();
  });

  it('clamps the expiry to the end of a shorter month', () => {
    const monthly = course({ enabled: true, validForMonths: 1 });
    const cert = issue({
      course: monthly,
      finish: { ...passed, completedAt: '2027-01-31T12:00:00Z' },
    });
    expect(cert.expiresOn).toBe('2027-02-28');
  });

  it('refuses an unfinished course and a malformed code', () => {
    const unfinished = { status: 'in_progress' as const, completedAt: null, score: null };
    expect(() => issue({ finish: unfinished })).toThrow(RangeError);
    expect(() => issue({ code: 'ABCD-EFGH-JKMN' })).toThrow(RangeError);
  });
});

describe('withCertificateStatus', () => {
  it('adds the status for the day, which the API schema accepts', () => {
    const cert = issue();
    expect(withCertificateStatus(cert, '2027-09-26').status).toBe('valid');
    expect(withCertificateStatus(cert, '2027-09-27').status).toBe('expiring_soon');
    expect(withCertificateStatus(cert, '2027-10-27').status).toBe('expired');
    expect(withCertificateStatus(cert, '2027-10-20', 5).status).toBe('valid');
    expect(CertificateSchema.parse(withCertificateStatus(cert, '2026-10-27'))).toEqual({
      ...cert,
      status: 'valid',
    });
  });
});

describe('currentCertificates', () => {
  it("keeps each learner's latest certificate per course, in input order", () => {
    const first = issue();
    const renewed = issue({
      id: 'cert-2',
      code: otherCode,
      finish: { ...passed, completedAt: '2027-10-01T09:30:00.000Z' },
    });
    const bo = { ...first, id: 'cert-3', learnerId: 'u-bo', learnerName: 'Bo Sample' };
    const otherCourse = { ...first, id: 'cert-4', courseId: 'call-wrap-up' };
    expect(currentCertificates([renewed, bo, first, otherCourse]).map((c) => c.id)).toEqual([
      'cert-2',
      'cert-3',
      'cert-4',
    ]);
    expect(currentCertificates([])).toEqual([]);
  });
});

describe('certificateNoticeDue', () => {
  const cert = { expiresOn: '2027-10-27' };

  it('sends the heads-up once, then "expired" once', () => {
    const sent: SentCertificateNotice[] = [];
    const run = (today: string) => {
      const kind = certificateNoticeDue(cert, sent, today);
      if (kind) sent.push({ kind, on: today });
      return kind;
    };
    expect(run('2027-09-26')).toBeNull();
    expect(run('2027-09-27')).toBe('expiring_soon');
    expect(run('2027-09-27')).toBeNull();
    expect(run('2027-10-26')).toBeNull();
    expect(run('2027-10-27')).toBe('expired');
    expect(run('2027-11-30')).toBeNull();
    expect(sent).toEqual([
      { kind: 'expiring_soon', on: '2027-09-27' },
      { kind: 'expired', on: '2027-10-27' },
    ]);
  });

  it('only says "expired" when the heads-up was missed', () => {
    expect(certificateNoticeDue(cert, [], '2027-11-02')).toBe('expired');
  });

  it('never sends anything for a certificate that never expires', () => {
    expect(certificateNoticeDue({ expiresOn: null }, [], '2099-01-01')).toBeNull();
  });

  it('uses the heads-up window it is given', () => {
    expect(certificateNoticeDue(cert, [], '2027-10-19', 7)).toBeNull();
    expect(certificateNoticeDue(cert, [], '2027-10-20', 7)).toBe('expiring_soon');
  });
});

describe('certificateNotice', () => {
  const cert = {
    id: 'cert 1',
    courseId: 'safe payments',
    courseTitle: 'Safe payments',
    expiresOn: '2027-10-27',
  };

  it('names the course and links to it when the person can open it', () => {
    expect(
      certificateNotice('expiring_soon', cert, { today: '2027-09-27', canOpen: true }),
    ).toEqual({
      title: 'Certificate expires in 30 days',
      text: 'Your certificate for “Safe payments” expires in 30 days. Take the course again to renew it.',
      buttons: [{ label: 'Open course', href: '/learning/courses/safe%20payments' }],
    });
    expect(certificateNotice('expired', cert, { today: '2027-10-27', canOpen: true })).toEqual({
      title: 'Certificate expired',
      text: 'Your certificate for “Safe payments” expired today. Take the course again to renew it.',
      buttons: [{ label: 'Open course', href: '/learning/courses/safe%20payments' }],
    });
  });

  it('keeps the course title out when the person might not have access', () => {
    const notice = certificateNotice('expired', cert, { today: '2027-10-30', canOpen: false });
    expect(notice).toEqual({
      title: 'Certificate expired',
      text: 'One of your certificates expired 3 days ago.',
      buttons: [{ label: 'Open certificate', href: '/learning/certificates/cert%201' }],
    });
    expect(JSON.stringify(notice)).not.toContain('Safe payments');
  });

  it('says tomorrow and yesterday', () => {
    const soon = certificateNotice('expiring_soon', cert, { today: '2027-10-26', canOpen: false });
    expect(soon.text).toBe('One of your certificates expires tomorrow.');
    const late = certificateNotice('expired', cert, { today: '2027-10-28', canOpen: false });
    expect(late.text).toBe('One of your certificates expired yesterday.');
  });
});

describe('recertificationDueDate', () => {
  const cert = { expiresOn: '2027-10-27' };

  it('reassigns from the heads-up window on, due on the expiry day', () => {
    expect(recertificationDueDate(cert, '2027-09-26')).toBeNull();
    expect(recertificationDueDate(cert, '2027-09-27')).toBe('2027-10-27');
    expect(recertificationDueDate(cert, '2027-10-26')).toBe('2027-10-27');
  });

  it('is due today once the certificate has expired', () => {
    expect(recertificationDueDate(cert, '2027-10-27')).toBe('2027-10-27');
    expect(recertificationDueDate(cert, '2027-12-01')).toBe('2027-12-01');
  });

  it('never reassigns a certificate that never expires', () => {
    expect(recertificationDueDate({ expiresOn: null }, '2099-01-01')).toBeNull();
  });
});

describe('certificate API schemas', () => {
  const sent = withCertificateStatus(issue(), '2026-10-27');

  it('rejects codes with a typo, lowercase codes and unknown keys', () => {
    const typo = `${code.slice(0, 13)}${code.at(13) === '0' ? '1' : '0'}`;
    expect(CertificateSchema.safeParse({ ...sent, code: typo }).success).toBe(false);
    expect(CertificateSchema.safeParse({ ...sent, code: code.toLowerCase() }).success).toBe(false);
    expect(CertificateSchema.safeParse({ ...sent, html: '<b>' }).success).toBe(false);
    expect(CertificateListResponseSchema.parse([sent, sent])).toHaveLength(2);
  });

  it('reads the list query and normalises a typed code', () => {
    expect(CertificateListQuerySchema.parse({})).toEqual({});
    const typed = code.toLowerCase().replaceAll('-', ' ');
    expect(CertificateListQuerySchema.parse({ code: typed, personId: 'u-ada' })).toEqual({
      code,
      personId: 'u-ada',
    });
    expect(CertificateListQuerySchema.safeParse({ code: 'not a code' }).success).toBe(false);
    expect(CertificateListQuerySchema.safeParse({ personId: ['a', 'b'] }).success).toBe(false);
    expect(CertificateListQuerySchema.safeParse({ format: 'csv' }).success).toBe(false);
  });
});
