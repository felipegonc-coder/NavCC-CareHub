import { randomUUID } from 'node:crypto';
import {
  isCertificateCodeWellFormed,
  sampleMicrolearningCourse,
  type CertificateFinish,
  type Course,
} from '@carehub/learning';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import { users } from '../../auth/schema';
import { bindMemoryNotices, type MemoryNoticeStore } from '../../notices/testing';
import { canSeeCourse } from '../courses/access';
import { LearningError } from '../errors';
import { isLearningEnabled } from '../public';
import { sendCertificateNotices } from './expiry';
import * as certificates from './service';
import type { Viewer } from './viewer';

vi.mock('../courses/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/access')>()),
  canSeeCourse: vi.fn(async () => true),
}));
vi.mock('../public', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../public')>()),
  isLearningEnabled: vi.fn(async () => true),
}));

// Fictional people and courses only.

/** The microlearning sample with certificates on, valid for `months` (or for good). */
function certifiedCourse(months?: number): Course {
  const course = structuredClone(sampleMicrolearningCourse);
  return {
    ...course,
    id: `course-${randomUUID()}`,
    settings: { ...course.settings, certificate: { enabled: true, validForMonths: months } },
  };
}

const passed = (completedAt: string, score: number | null = 90): CertificateFinish => ({
  status: 'passed',
  completedAt,
  score,
});

type Permission = Parameters<Viewer['can']>[0];

function viewer(workspaceId: string, userId: string, ...permissions: Permission[]) {
  const can = (permission: Permission) => permissions.includes(permission);
  return { workspaceId, userId, can } satisfies Viewer;
}

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

describe.skipIf(!hasDatabase)('Learning certificates', () => {
  let server: TestApp;
  let db: Db;
  let notices: MemoryNoticeStore;
  let unbind: () => void;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    ({ store: notices, unbind } = bindMemoryNotices());
  });

  afterAll(async () => {
    unbind?.();
    await server?.close();
  });

  beforeEach(() => {
    vi.mocked(canSeeCourse).mockImplementation(async () => true);
    vi.mocked(isLearningEnabled).mockImplementation(async () => true);
  });

  /** A learner with a name and a time zone of their own. */
  async function learner(name: string, timeZone = 'UTC') {
    const user = await createUser(db, { name });
    await db.update(users).set({ timeZone }).where(eq(users.id, user.id));
    return user.id;
  }

  const issue = (
    workspaceId: string,
    learnerId: string,
    course: Course,
    finish: CertificateFinish,
    version = 1,
  ) => certificates.issueCertificate(db, { workspaceId, learnerId, course, version, finish });

  const RENEW = 'Take the course again to renew it.';
  const noticesFor = (learnerId: string) =>
    notices.records.filter((record) => record.userId === learnerId);

  it('issues one certificate per finish, dated on the learner’s own day', async () => {
    const workspaceId = randomUUID();
    const rosa = await learner('Rosa Learner', 'America/Denver');
    const course = certifiedCourse(12);
    // 03:00 UTC on March 16 is still March 15 in Denver.
    const first = await issue(workspaceId, rosa, course, passed('2026-03-16T03:00:00.000Z', 92), 3);
    expect(first).toMatchObject({
      learnerId: rosa,
      learnerName: 'Rosa Learner',
      courseId: course.id,
      courseTitle: course.title,
      courseVersion: 3,
      completedAt: '2026-03-16T03:00:00.000Z',
      issuedOn: '2026-03-15',
      expiresOn: '2027-03-15',
      score: 92,
    });
    expect(isCertificateCodeWellFormed(first?.code ?? '')).toBe(true);

    // The same finish again gets nothing new; a retake is a new finish with its own certificate.
    expect(await issue(workspaceId, rosa, course, passed('2026-03-16T03:00:00.000Z'))).toBeNull();
    const retake = await issue(workspaceId, rosa, course, {
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      score: null,
    });
    expect(retake).toMatchObject({ issuedOn: '2026-09-01', expiresOn: '2027-09-01', score: null });
    expect(retake?.code).not.toBe(first?.code);

    // A failed course, or one with certificates off, earns none.
    const failed = { status: 'failed', completedAt: null, score: 40 } as const;
    expect(await issue(workspaceId, rosa, course, failed)).toBeNull();
    const off = { ...course, settings: { ...course.settings, certificate: { enabled: false } } };
    expect(await issue(workspaceId, rosa, off, passed('2026-10-01T12:00:00.000Z'))).toBeNull();

    const own = viewer(workspaceId, rosa);
    const list = await certificates.listCertificates(db, own, {}, new Date('2027-02-20T12:00Z'));
    expect(list.map((cert) => cert.id)).toEqual([retake?.id, first?.id]);
    expect(list.map((cert) => cert.status)).toEqual(['valid', 'expiring_soon']);
  });

  it('shows people their own certificates, and anyone’s to people with analytics', async () => {
    const workspaceId = randomUUID();
    const [ana, ben] = [await learner('Ana Agent'), await learner('Ben Agent')];
    const [courseA, courseB] = [certifiedCourse(), certifiedCourse()];
    const anaFirst = await issue(workspaceId, ana, courseA, passed('2026-05-01T10:00:00.000Z'));
    const anaSecond = await issue(workspaceId, ana, courseB, passed('2026-06-01T10:00:00.000Z'));
    const bens = await issue(workspaceId, ben, courseA, passed('2026-05-02T10:00:00.000Z'));
    if (!anaFirst || !anaSecond || !bens) throw new Error('The certificates were not issued.');
    const asAna = viewer(workspaceId, ana);
    const analyst = viewer(workspaceId, randomUUID(), 'learning.analytics');
    const ids = (list: { id: string }[]) => list.map((cert) => cert.id);

    expect(ids(await certificates.listCertificates(db, asAna, {}))).toEqual([
      anaSecond.id,
      anaFirst.id,
    ]);
    expect(ids(await certificates.listCertificates(db, asAna, { courseId: courseA.id }))).toEqual([
      anaFirst.id,
    ]);
    expect(
      (await failure(certificates.listCertificates(db, asAna, { personId: ben }))).status,
    ).toBe(403);
    expect((await failure(certificates.getCertificate(db, asAna, bens.id))).status).toBe(404);
    expect((await failure(certificates.getCertificate(db, asAna, 'not-a-uuid'))).status).toBe(404);
    expect(await certificates.getCertificate(db, asAna, anaFirst.id)).toMatchObject({
      id: anaFirst.id,
      status: 'valid',
      expiresOn: null,
    });

    expect(ids(await certificates.listCertificates(db, analyst, { personId: ben }))).toEqual([
      bens.id,
    ]);
    expect((await certificates.getCertificate(db, analyst, bens.id)).learnerName).toBe('Ben Agent');

    // Looking a code up: analytics finds anyone's; others only their own.
    const lookup = (who: Viewer, code: string) => certificates.listCertificates(db, who, { code });
    expect(ids(await lookup(analyst, bens.code))).toEqual([bens.id]);
    expect(await lookup(asAna, bens.code)).toEqual([]);
    expect(ids(await lookup(viewer(workspaceId, ben), bens.code))).toEqual([bens.id]);

    // Another workspace sees none of them.
    const elsewhere = viewer(randomUUID(), randomUUID(), 'learning.analytics');
    expect(await lookup(elsewhere, bens.code)).toEqual([]);
    expect((await failure(certificates.getCertificate(db, elsewhere, bens.id))).status).toBe(404);
  });

  it('sends each expiry notice once, for current certificates only', async () => {
    const workspaceId = randomUUID();
    const [cara, dev, eli] = [
      await learner('Cara Agent'),
      await learner('Dev Agent'),
      await learner('Eli Agent'),
    ];
    const course = certifiedCourse(1);
    // Issued on 2031-01-10, so they expire on 2031-02-10.
    const caras = await issue(workspaceId, cara, course, passed('2031-01-10T12:00:00.000Z'));
    await issue(workspaceId, dev, course, passed('2031-01-10T12:00:00.000Z'));
    await issue(workspaceId, eli, course, passed('2031-01-10T12:00:00.000Z'));
    // Eli took it again: only the newer certificate counts, and it expires later.
    await issue(workspaceId, eli, course, passed('2031-01-31T12:00:00.000Z'));
    vi.mocked(canSeeCourse).mockImplementation(async (userId) => userId !== dev);
    const run = (at: string) => sendCertificateNotices(db, new Date(at));

    await run('2031-01-05T12:00:00Z');
    expect(noticesFor(cara)).toEqual([]);

    await run('2031-01-20T12:00:00Z');
    await run('2031-01-20T18:00:00Z');
    expect(noticesFor(cara)).toMatchObject([
      {
        workspaceId,
        kind: 'reminder',
        sender: 'Learning',
        title: 'Certificate expires in 21 days',
        text: `Your certificate for “${course.title}” expires in 21 days. ${RENEW}`,
        buttons: [{ label: 'Open course', href: `/learning/courses/${course.id}` }],
      },
    ]);
    // Without access to the course, the notice doesn't name it.
    expect(noticesFor(dev)).toMatchObject([
      {
        text: 'One of your certificates expires in 21 days.',
        buttons: [{ label: 'Open certificate' }],
      },
    ]);
    expect(noticesFor(eli)).toEqual([]);

    await run('2031-02-10T12:00:00Z');
    await run('2031-02-11T12:00:00Z');
    expect(noticesFor(cara).map((notice) => [notice.kind, notice.title])).toEqual([
      ['reminder', 'Certificate expires in 21 days'],
      ['alert', 'Certificate expired'],
    ]);
    expect(noticesFor(eli).map((notice) => notice.title)).toEqual([
      'Certificate expires in 18 days',
    ]);
    const later = new Date('2031-02-11T12:00:00Z');
    const asCara = viewer(workspaceId, cara);
    expect(await certificates.listCertificates(db, asCara, {}, later)).toMatchObject([
      { id: caras?.id, status: 'expired' },
    ]);
  });

  it('sends nothing while Learning is off, and catches up once it is on', async () => {
    const workspaceId = randomUUID();
    const fay = await learner('Fay Agent');
    await issue(workspaceId, fay, certifiedCourse(1), passed('2032-01-10T12:00:00.000Z'));
    vi.mocked(isLearningEnabled).mockImplementation(async (id) => id !== workspaceId);

    await sendCertificateNotices(db, new Date('2032-01-20T12:00:00Z'));
    expect(noticesFor(fay)).toEqual([]);

    vi.mocked(isLearningEnabled).mockImplementation(async () => true);
    await sendCertificateNotices(db, new Date('2032-02-12T12:00:00Z'));
    // The heads-up was missed, so only "expired" goes out.
    expect(noticesFor(fay).map((notice) => notice.title)).toEqual(['Certificate expired']);
  });
});
