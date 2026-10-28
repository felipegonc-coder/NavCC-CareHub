import { randomUUID } from 'node:crypto';
import {
  planAttempt,
  sampleCertificationCourse,
  stripBankSnapshots,
  type BankReply,
  type Course,
  type ProgressEvent,
  type QuestionBank,
  type QuizLesson,
  type StudioCourse,
  type SurveySummary,
} from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { getLiveCourse } from '../courses/service';
import { bindCourseVersions } from '../progress/courses';
import { learningProgress, learningProgressEvents } from '../progress/schema';
import learningRoutes from '../routes';
import { sampleBanks } from './seed';

// Core doesn't put the workspace member on requests yet (accounts 1b), so this app does it from the
// x-test-person header, the way core's sessions will. Fictional data only.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    workspaceId,
    roleId: 'role-trainer',
    permissions: ['learning.build'],
  },
  stranger: {
    id: randomUUID(),
    workspaceId: randomUUID(),
    roleId: 'role-trainer',
    permissions: ['learning.build'],
  },
  learner: { id: randomUUID(), workspaceId, roleId: 'role-viewer', permissions: [] },
  analyst: {
    id: randomUUID(),
    workspaceId,
    roleId: 'role-analyst',
    permissions: ['learning.analytics'],
  },
  publisher: {
    id: randomUUID(),
    workspaceId: randomUUID(),
    roleId: 'role-trainer',
    permissions: ['learning.build'],
  },
};
type Person = keyof typeof PEOPLE;

const HEADER = 'Type,Question,Answer 1,Answer 2,Correct';

describe.skipIf(!hasDatabase)('Learning question banks API', () => {
  let server: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    server = await createTestApp();
    app = Fastify();
    app.decorate('db', server.db);
    app.decorateRequest('user', null);
    app.decorateRequest('member', null);
    app.addHook('onRequest', async (request) => {
      const person = PEOPLE[request.headers['x-test-person'] as Person];
      if (!person) return;
      const { id, workspaceId: inWorkspace, roleId, permissions } = person;
      Object.assign(request, {
        user: { id },
        member: { workspaceId: inWorkspace, roleId, permissions: new Set(permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  const call = (
    person: Person | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: object,
  ) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

  it('lets in only people who build courses', async () => {
    expect((await call(null, 'GET', '/studio/banks')).statusCode).toBe(401);
    const learner = await call('learner', 'GET', '/studio/banks');
    expect(learner.statusCode).toBe(403);
    expect(learner.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    expect((await call('learner', 'POST', '/studio/banks', { title: 'Mine' })).statusCode).toBe(
      403,
    );
  });

  it('creates, saves, imports into and deletes a bank, with the revision check', async () => {
    const created = await call('trainer', 'POST', '/studio/banks', { title: ' Escalations ' });
    expect(created.statusCode).toBe(201);
    const { bank, revision }: BankReply = created.json();
    expect(bank).toMatchObject({ title: 'Escalations', questions: [] });
    expect(revision).toBe(1);
    expect((await call('trainer', 'GET', '/studio/banks')).json()).toEqual([
      { id: bank.id, title: 'Escalations', questionCount: 0, updatedAt: expect.any(String) },
    ]);
    expect((await call('stranger', 'GET', '/studio/banks')).json()).toEqual([]);
    expect((await call('stranger', 'GET', `/studio/banks/${bank.id}`)).statusCode).toBe(404);

    const edited: QuestionBank = { ...bank, description: 'Who handles what.' };
    const saved = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, {
      bank: edited,
      revision,
    });
    expect(saved.json()).toEqual({ revision: 2 });
    const stale = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, { bank, revision });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'conflict' } });
    const invalid = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, {
      bank: { ...edited, title: '' },
      revision: 2,
    });
    expect(invalid.statusCode).toBe(400);

    const imported = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: `${HEADER}\r\nSingle choice,Who handles refunds?,Repairs,Billing,2\r\nSingle choice,Nobody is right here,Repairs,Billing,`,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ added: 1, errors: [{ row: 3 }] });
    const reloaded: BankReply = (await call('trainer', 'GET', `/studio/banks/${bank.id}`)).json();
    expect(reloaded).toMatchObject({ revision: 3, bank: { description: 'Who handles what.' } });
    expect(reloaded.bank.questions).toHaveLength(1);

    expect((await call('stranger', 'DELETE', `/studio/banks/${bank.id}`)).statusCode).toBe(404);
    expect((await call('trainer', 'DELETE', `/studio/banks/${bank.id}`)).statusCode).toBe(204);
    expect((await call('trainer', 'GET', `/studio/banks/${bank.id}`)).statusCode).toBe(404);
  });

  it('takes spreadsheets over 1 MB, and refuses text over the import limit with a reason', async () => {
    const { bank }: BankReply = (
      await call('trainer', 'POST', '/studio/banks', { title: 'Big imports' })
    ).json();
    const long = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: `${HEADER}\r\nTrue or false,${'x'.repeat(1_500_000)},,,true`,
    });
    expect(long.statusCode).toBe(200);
    expect(long.json()).toMatchObject({ added: 0 });
    const tooBig = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: 'x'.repeat(2_000_001),
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json()).toMatchObject({ error: { issues: [{ path: 'csv' }] } });
  });

  it('publishes a course with copies of the questions it draws, and refuses while the bank is too small', async () => {
    const { bank }: BankReply = (
      await call('publisher', 'POST', '/studio/banks', { title: 'Escalation questions' })
    ).json();
    const filled = { ...bank, questions: sampleBanks()[0]?.questions ?? [] };
    const saveBank = (questions: QuestionBank['questions'], revision: number) =>
      call('publisher', 'PUT', `/studio/banks/${bank.id}`, {
        bank: { ...filled, questions },
        revision,
      });
    expect((await saveBank(filled.questions, 1)).json()).toEqual({ revision: 2 });

    const created: StudioCourse = (
      await call('publisher', 'POST', '/studio/courses', { type: 'certification' })
    ).json();
    const draft: Course = {
      ...stripBankSnapshots(sampleCertificationCourse),
      id: created.course.id,
    };
    const lessons = draft.lessons.map((lesson) =>
      lesson.kind === 'quiz' && lesson.bankDraws
        ? {
            ...lesson,
            bankDraws: lesson.bankDraws.map(({ count }) => ({ bankId: bank.id, count })),
          }
        : lesson,
    );
    const course = { ...draft, lessons };
    const saved = await call('publisher', 'PUT', `/studio/courses/${course.id}`, {
      course,
      revision: created.revision,
    });
    expect(saved.statusCode).toBe(200);
    const publish = () =>
      call('publisher', 'POST', `/studio/courses/${course.id}/publish`, { notify: 'none' });
    expect((await publish()).json()).toEqual({ version: 1 });
    const live = await getLiveCourse(server.db, PEOPLE.publisher.workspaceId, course.id);
    const draws = live?.course.lessons.flatMap((lesson) =>
      lesson.kind === 'quiz' ? (lesson.bankDraws ?? []) : [],
    );
    expect(draws).toEqual([{ bankId: bank.id, count: 2, questions: filled.questions }]);

    expect((await saveBank(filled.questions.slice(0, 1), 2)).json()).toEqual({ revision: 3 });
    const refused = await publish();
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({
      error: {
        code: 'cannot_publish',
        message: 'Fix this problem before publishing.',
        issues: [
          expect.objectContaining({
            message:
              'Lesson 2 "Certification exam": draws 2 questions from the bank "Escalation questions", which has only 1.',
          }),
        ],
      },
    });
  });

  it("reports a survey's answer counts from each learner's current run, to people who see reports", async () => {
    // Version 2 of the certification sample is live; its versions are bound here instead of published.
    const course: Course = {
      ...sampleCertificationCourse,
      settings: { ...sampleCertificationCourse.settings, lessonOrder: 'free' },
    };
    const survey = course.lessons.find((lesson) => lesson.id === 'esc-feedback') as QuizLesson;
    const ours = (inWorkspace: string, courseId: string) =>
      inWorkspace === workspaceId && courseId === course.id;
    bindCourseVersions({
      live: async (_db, inWorkspace, courseId) =>
        ours(inWorkspace, courseId) ? { course, version: 2 } : null,
      version: async (_db, inWorkspace, courseId, version) =>
        ours(inWorkspace, courseId) && version === 2 ? { course, version } : null,
    });
    try {
      const [ana, ben, cy] = [randomUUID(), randomUUID(), randomUUID()];
      await server.db.insert(learningProgress).values([
        { workspaceId, learnerId: ana, courseId: course.id, version: 2 },
        { workspaceId, learnerId: ben, courseId: course.id, version: 2 },
        { workspaceId, learnerId: cy, courseId: course.id, version: 2, run: 2 },
      ]);
      const took = (learnerId: string, run: number, attemptId: string, optionId: string) => {
        const start: ProgressEvent = {
          id: `${attemptId}-start`,
          at: '2026-10-27T09:00:00.000Z',
          type: 'quiz_attempt_started',
          lessonId: survey.id,
          plan: planAttempt(survey, 7, attemptId),
        };
        const submit: ProgressEvent = {
          id: `${attemptId}-submit`,
          at: '2026-10-27T09:05:00.000Z',
          type: 'quiz_attempt_submitted',
          lessonId: survey.id,
          attemptId,
          responses: { 'esc-survey-useful': { type: 'single_choice', optionId } },
        };
        return [start, submit].map((event) => ({
          workspaceId,
          learnerId,
          courseId: course.id,
          eventId: event.id,
          run,
          event,
        }));
      };
      // Cy's first run was reset, so only the second one counts.
      await server.db
        .insert(learningProgressEvents)
        .values([
          ...took(ana, 1, 'attempt-ana', 'very'),
          ...took(ben, 1, 'attempt-ben', 'not'),
          ...took(cy, 1, 'attempt-cy-1', 'not'),
          ...took(cy, 2, 'attempt-cy-2', 'very'),
        ]);

      const url = `/reports/courses/${course.id}/surveys/${survey.id}`;
      expect((await call('trainer', 'GET', url)).statusCode).toBe(403);
      const reply = await call('analyst', 'GET', url);
      expect(reply.statusCode).toBe(200);
      const summary: SurveySummary = reply.json();
      expect(summary).toMatchObject({ lessonId: survey.id, submissions: 3 });
      expect(summary.questions.map(({ questionId, answered }) => [questionId, answered])).toEqual([
        ['esc-survey-useful', 3],
        ['esc-survey-more', 0],
      ]);
      expect(summary.questions[0]?.answers.map(({ optionId, count }) => [optionId, count])).toEqual(
        [
          ['very', 2],
          ['somewhat', 0],
          ['not', 1],
        ],
      );
      const text = JSON.stringify(summary);
      for (const learnerId of [ana, ben, cy]) expect(text).not.toContain(learnerId);

      const graded = await call('analyst', 'GET', `/reports/courses/${course.id}/surveys/esc-exam`);
      expect(graded.statusCode).toBe(404);
      const unpublished = await call(
        'analyst',
        'GET',
        `/reports/courses/course-nowhere/surveys/${survey.id}`,
      );
      expect(unpublished.statusCode).toBe(404);
      expect(unpublished.json()).toMatchObject({
        error: { message: "This course isn't published, so it has no survey results yet." },
      });
    } finally {
      bindCourseVersions(null);
    }
  });
});
