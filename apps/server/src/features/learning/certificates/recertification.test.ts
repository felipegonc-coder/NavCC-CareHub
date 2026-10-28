import { randomUUID } from 'node:crypto';
import { sampleMicrolearningCourse, type Course } from '@carehub/learning';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import type { Recertification } from '../assignments';
import {
  learningProgressChanges as changes,
  learningProgress as progressRows,
} from '../progress/schema';
import * as progress from '../progress/service';
import { bindMemoryCourseVersions, type MemoryCourseVersions } from '../progress/testing';
import { reassignExpiringCertificates, type Reassign } from './expiry';
import { learningCertificates as certificates } from './schema';

// Fictional people and courses only. The years are far ahead, so other tests' certificates stay
// out of the way, and assignments answer for this test's workspace only.

/** A trainer and learners in a workspace of their own. */
function workspace(size: number) {
  const workspaceId = randomUUID();
  const person = (): progress.Actor => ({ userId: randomUUID(), workspaceId });
  return { workspaceId, trainer: person(), learners: Array.from({ length: size }, person) };
}

/** Assignments in memory for one workspace: each re-certification asked for, and its answer. */
function memoryAssignments(workspaceId: string, assigns = true) {
  const calls: Recertification[] = [];
  const reassign: Reassign = async (_tx, input) => {
    if (input.workspaceId !== workspaceId) return null;
    calls.push(input);
    return assigns ? randomUUID() : null;
  };
  return { calls, reassign };
}

const FINISHED = new Date('2036-03-02T09:00:00.000Z');
const NOTE = 'Re-certification: the certificate runs out on 2037-03-02.';

describe.skipIf(!hasDatabase)('Learning re-certification', () => {
  let server: TestApp;
  let db: Db;
  let courses: MemoryCourseVersions;
  let unbind: () => void;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
    ({ courses, unbind } = bindMemoryCourseVersions());
  });

  afterAll(async () => {
    unbind?.();
    await server?.close();
  });

  /** The microlearning sample giving certificates valid for `months` (or for good), published. */
  function certifiedCourse(workspaceId: string, months?: number): Course {
    const { settings } = sampleMicrolearningCourse;
    const course: Course = {
      ...structuredClone(sampleMicrolearningCourse),
      id: `course-${randomUUID()}`,
      settings: { ...settings, certificate: { enabled: true, validForMonths: months } },
    };
    courses.publish(workspaceId, course);
    return course;
  }

  const rowOf = async (learner: progress.Actor, courseId: string) => {
    const [row] = await db
      .select()
      .from(progressRows)
      .where(
        and(
          eq(progressRows.workspaceId, learner.workspaceId),
          eq(progressRows.learnerId, learner.userId),
          eq(progressRows.courseId, courseId),
        ),
      );
    return row;
  };

  const changesOf = async (learner: progress.Actor) => {
    const rows = await db
      .select()
      .from(changes)
      .where(
        and(eq(changes.workspaceId, learner.workspaceId), eq(changes.learnerId, learner.userId)),
      )
      .orderBy(asc(changes.changedAt));
    return rows.map(({ kind, run, changedBy, note }) => ({ kind, run, changedBy, note }));
  };

  const certificatesOf = (learner: progress.Actor) =>
    db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.workspaceId, learner.workspaceId),
          eq(certificates.learnerId, learner.userId),
        ),
      )
      .orderBy(asc(certificates.completedAt));

  it('assigns the course again from the heads-up on, once, and starts the next run', async () => {
    const {
      workspaceId,
      trainer,
      learners: [ada],
    } = workspace(1);
    if (!ada) throw new Error('A learner expected.');
    const course = certifiedCourse(workspaceId, 12);
    await progress.completeProgress(db, trainer, ada.userId, course.id, undefined, FINISHED);
    // Version 2 goes live without moving anyone.
    const live = courses.publish(workspaceId, course);
    const assignments = memoryAssignments(workspaceId);
    const run = (at: string) =>
      reassignExpiringCertificates(db, new Date(at), assignments.reassign);

    // The certificate runs out on 2037-03-02: 41 days before is too early.
    expect(await run('2037-01-20T12:00:00Z')).toBe(0);
    expect(assignments.calls).toEqual([]);

    const at = '2037-02-05T12:00:00Z';
    expect(await run(at)).toBe(1);
    expect(assignments.calls).toEqual([
      { workspaceId, courseId: course.id, userId: ada.userId, dueDate: '2037-03-02' },
    ]);
    expect(await rowOf(ada, course.id)).toMatchObject({
      run: 2,
      version: live,
      runStartedAt: new Date(at),
      status: 'not_started',
      completedAt: null,
      markedCompleteAt: null,
      previousFinishedAt: FINISHED,
    });
    expect(await changesOf(ada)).toEqual([
      { kind: 'complete', run: 1, changedBy: trainer.userId, note: null },
      { kind: 'retake', run: 2, changedBy: null, note: NOTE },
    ]);
    expect(await certificatesOf(ada)).toMatchObject([
      { expiresOn: '2037-03-02', reassignedOn: '2037-02-05' },
    ]);
    const [state] = await progress.listCourseStates(db, { workspaceId, userIds: [ada.userId] });
    expect(state).toMatchObject({
      status: 'not_started',
      previousFinishedAt: FINISHED.toISOString(),
    });

    // Once per certificate.
    expect(await run('2037-03-05T12:00:00Z')).toBe(0);
    expect(assignments.calls).toHaveLength(1);
  });

  it('waits while nothing can be assigned, and keeps a run that has not ended', async () => {
    const {
      workspaceId,
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const course = certifiedCourse(workspaceId, 12);
    for (const learner of [ada, bo]) {
      await progress.completeProgress(db, trainer, learner.userId, course.id, undefined, FINISHED);
    }
    // After the expiry day, with Learning off or the course not live: nothing changes yet.
    const at = new Date('2037-03-10T12:00:00Z');
    const off = memoryAssignments(workspaceId, false);
    expect(await reassignExpiringCertificates(db, at, off.reassign)).toBe(0);
    expect(off.calls).toHaveLength(2);
    expect(await rowOf(ada, course.id)).toMatchObject({ run: 1, status: 'completed' });
    expect((await certificatesOf(ada)).map((cert) => cert.reassignedOn)).toEqual([null]);

    // Bo's progress was reset, and his new run is kept rather than started over.
    await progress.resetProgress(db, trainer, bo.userId, course.id, 'Refresher', at);
    const on = memoryAssignments(workspaceId);
    expect(await reassignExpiringCertificates(db, at, on.reassign)).toBe(2);
    expect(on.calls.map(({ userId, dueDate }) => ({ userId, dueDate }))).toEqual(
      expect.arrayContaining([
        { userId: ada.userId, dueDate: '2037-03-10' },
        { userId: bo.userId, dueDate: '2037-03-10' },
      ]),
    );
    expect(await rowOf(ada, course.id)).toMatchObject({ run: 2, status: 'not_started' });
    expect(await rowOf(bo, course.id)).toMatchObject({ run: 2, status: 'not_started' });
    expect((await changesOf(bo)).map(({ kind, run }) => [kind, run])).toEqual([
      ['complete', 1],
      ['reset', 2],
    ]);
    expect((await certificatesOf(bo)).map((cert) => cert.reassignedOn)).toEqual(['2037-03-10']);
  });

  it('leaves certificates that never expire or were replaced by a newer one', async () => {
    const {
      workspaceId,
      trainer,
      learners: [ada, bo],
    } = workspace(2);
    if (!ada || !bo) throw new Error('Two learners expected.');
    const forGood = certifiedCourse(workspaceId);
    const yearly = certifiedCourse(workspaceId, 12);
    await progress.completeProgress(db, trainer, ada.userId, forGood.id, undefined, FINISHED);
    // Bo finished twice; the second certificate runs out on 2037-09-01.
    await progress.completeProgress(db, trainer, bo.userId, yearly.id, undefined, FINISHED);
    const again = new Date('2036-09-01T09:00:00.000Z');
    await progress.resetProgress(db, trainer, bo.userId, yearly.id, undefined, again);
    await progress.completeProgress(db, trainer, bo.userId, yearly.id, undefined, again);
    expect((await certificatesOf(bo)).map((cert) => cert.expiresOn)).toEqual([
      '2037-03-02',
      '2037-09-01',
    ]);

    const assignments = memoryAssignments(workspaceId);
    const at = new Date('2037-02-20T12:00:00Z');
    expect(await reassignExpiringCertificates(db, at, assignments.reassign)).toBe(0);
    expect(assignments.calls).toEqual([]);
    expect(await rowOf(bo, yearly.id)).toMatchObject({ run: 2, status: 'completed' });
  });
});
