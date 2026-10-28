import {
  sampleCertificationCourse,
  stripBankSnapshots,
  type Course,
  type Question,
  type QuestionBank,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { LearningError } from '../errors';
import { sampleBanks } from './seed';
import {
  createBank,
  deleteBank,
  getBank,
  importQuestions,
  listBanks,
  saveBank,
  withBankQuestions,
} from './service';
import { memoryBankStore } from './testing';

// Fictional data only.
const workspace = '00000000-0000-4000-8000-000000000001';
const otherWorkspace = '00000000-0000-4000-8000-000000000002';
const trainer = { userId: '00000000-0000-4000-8000-00000000000a', workspaceId: workspace };

function setup() {
  let time = Date.parse('2026-10-27T09:00:00.000Z');
  return memoryBankStore(() => new Date((time += 60_000)));
}

const trueFalse = (id: string, answer = true): Question => ({
  id,
  type: 'true_false',
  prompt: [{ runs: [{ text: `Statement ${id}` }] }],
  points: 1,
  answer,
});

/** The error a call was refused with. */
async function refusal(call: Promise<unknown>): Promise<LearningError> {
  try {
    await call;
  } catch (error) {
    return error as LearningError;
  }
  throw new Error('The call should have been refused.');
}

const HEADER = 'Type,Question,Answer 1,Answer 2,Correct';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n');

describe('question banks', () => {
  it('creates empty banks and lists them in title order, questions only counted', async () => {
    const store = setup();
    const wound = await createBank(store, trainer, { title: 'Wound care' });
    await createBank(store, trainer, { title: 'Escalations', description: 'Who handles what.' });
    expect(wound).toMatchObject({ revision: 1, updatedAt: '2026-10-27T09:01:00.000Z' });
    expect(wound.bank).toMatchObject({ formatVersion: 1, title: 'Wound care', questions: [] });

    const list = await listBanks(store, workspace);
    expect(list.map((bank) => bank.title)).toEqual(['Escalations', 'Wound care']);
    expect(list[0]).toMatchObject({ description: 'Who handles what.', questionCount: 0 });
    expect(list[1]).toEqual({
      id: wound.bank.id,
      title: 'Wound care',
      questionCount: 0,
      updatedAt: '2026-10-27T09:01:00.000Z',
    });
    expect(await listBanks(store, otherWorkspace)).toEqual([]);
  });

  it('gets a bank with its revision, never one from another workspace', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    expect(await getBank(store, workspace, bank.id)).toEqual({
      bank,
      revision: 1,
      updatedAt: '2026-10-27T09:01:00.000Z',
    });
    expect(await refusal(getBank(store, otherWorkspace, bank.id))).toMatchObject({ status: 404 });
  });

  it('saves on top of the revision it started from and refuses a stale save', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    const edited: QuestionBank = {
      ...bank,
      title: 'Escalation rules',
      questions: [trueFalse('q1')],
    };
    expect(await saveBank(store, workspace, bank.id, { bank: edited, revision: 1 })).toEqual({
      revision: 2,
    });
    expect(
      await refusal(
        saveBank(store, workspace, bank.id, { bank: { ...bank, title: 'Mine' }, revision: 1 }),
      ),
    ).toMatchObject({
      status: 409,
      message: 'Someone else saved this bank since you opened it. Reload to see their changes.',
    });
    expect(await getBank(store, workspace, bank.id)).toMatchObject({ bank: edited, revision: 2 });
    expect((await listBanks(store, workspace))[0]).toMatchObject({ questionCount: 1 });
  });

  it('refuses a save for another address (400) or a bank that is gone (404)', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    expect(
      await refusal(saveBank(store, workspace, 'another-bank', { bank, revision: 1 })),
    ).toMatchObject({ status: 400, issues: [{ path: 'bank.id' }] });
    expect(
      await refusal(saveBank(store, otherWorkspace, bank.id, { bank, revision: 1 })),
    ).toMatchObject({ status: 404 });
  });

  it('deletes a bank once', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    expect(await refusal(deleteBank(store, otherWorkspace, bank.id))).toMatchObject({
      status: 404,
    });
    await deleteBank(store, workspace, bank.id);
    expect(await refusal(getBank(store, workspace, bank.id))).toMatchObject({ status: 404 });
    expect(await refusal(deleteBank(store, workspace, bank.id))).toMatchObject({ status: 404 });
  });
});

describe('importQuestions', () => {
  it('adds the ready rows at the end of the bank and lists the rows to fix', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    await saveBank(store, workspace, bank.id, {
      bank: { ...bank, questions: [trueFalse('q1')] },
      revision: 1,
    });
    const reply = await importQuestions(
      store,
      workspace,
      bank.id,
      csv(
        'Single choice,Who handles refunds?,Repairs,Billing,2',
        'Single choice,Nobody is right here,Repairs,Billing,',
        'True or false,Urgent calls go to the duty lead.,,,true',
      ),
    );
    expect(reply.added).toBe(2);
    expect(reply.errors.map((error) => error.row)).toEqual([3]);
    const saved = await getBank(store, workspace, bank.id);
    expect(saved.revision).toBe(3);
    expect(saved.bank.questions.map((question) => question.type)).toEqual([
      'true_false',
      'single_choice',
      'true_false',
    ]);
    const ids = saved.bank.questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('leaves out rows that do not fit in a full bank', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    const questions = Array.from({ length: 499 }, (_, index) => trueFalse(`q${index + 1}`));
    await saveBank(store, workspace, bank.id, { bank: { ...bank, questions }, revision: 1 });
    const reply = await importQuestions(
      store,
      workspace,
      bank.id,
      csv('True or false,One more.,,,true', 'True or false,One too many.,,,false'),
    );
    expect(reply).toEqual({
      added: 1,
      errors: [
        {
          row: 3,
          message: 'The bank is full (it holds at most 500 questions), so this row was left out.',
        },
      ],
    });
    expect((await getBank(store, workspace, bank.id)).bank.questions).toHaveLength(500);
  });

  it('saves nothing when no row is ready, and refuses a bank that is gone', async () => {
    const store = setup();
    const { bank } = await createBank(store, trainer, { title: 'Escalations' });
    const reply = await importQuestions(
      store,
      workspace,
      bank.id,
      csv('Single choice,No answers,,,'),
    );
    expect(reply.added).toBe(0);
    expect(reply.errors.length > 0).toBe(true);
    expect((await getBank(store, workspace, bank.id)).revision).toBe(1);
    expect(
      await refusal(
        importQuestions(store, otherWorkspace, bank.id, csv('True or false,Yes.,,,true')),
      ),
    ).toMatchObject({ status: 404 });
  });
});

describe('withBankQuestions', () => {
  const draft = stripBankSnapshots(sampleCertificationCourse);
  const drawsOf = (course: Course) =>
    course.lessons.flatMap((lesson) => (lesson.kind === 'quiz' ? (lesson.bankDraws ?? []) : []));

  async function seeded(workspaceId = workspace) {
    const store = setup();
    for (const bank of sampleBanks()) {
      await store.insert({ workspaceId, id: bank.id, bank, createdBy: trainer.userId });
    }
    return store;
  }

  it('copies the sample banks into the sample course, as its published version has them', async () => {
    const published = await withBankQuestions(await seeded(), workspace, draft);
    expect(drawsOf(draft).every((draw) => draw.questions === undefined)).toBe(true);
    expect(drawsOf(published)).toEqual(drawsOf(sampleCertificationCourse));
  });

  it('refuses to publish when a drawn bank is gone or in another workspace', async () => {
    const error = await refusal(withBankQuestions(await seeded(otherWorkspace), workspace, draft));
    expect(error).toMatchObject({ status: 422, message: 'Fix this problem before publishing.' });
    expect(error.issues?.map((issue) => issue.message)).toEqual([
      'Lesson 2 "Certification exam": draws from a question bank that no longer exists ("bank-escalations"). Choose another bank or remove the draw.',
    ]);
  });

  it('names a bank with too few questions by its title', async () => {
    const store = setup();
    const [sample] = sampleBanks();
    if (!sample) throw new Error('the sample courses should draw from a bank');
    const bank = { ...sample, questions: sample.questions.slice(0, 1) };
    await store.insert({ workspaceId: workspace, id: bank.id, bank, createdBy: trainer.userId });
    const error = await refusal(withBankQuestions(store, workspace, draft));
    expect(error.status).toBe(422);
    expect(error.issues?.map((issue) => issue.message)).toEqual([
      'Lesson 2 "Certification exam": draws 2 questions from the bank "Escalation questions", which has only 1.',
    ]);
  });

  it('leaves a course without bank draws as it is', async () => {
    const course = { ...draft, lessons: draft.lessons.filter((lesson) => lesson.kind !== 'quiz') };
    expect(await withBankQuestions(setup(), workspace, course)).toBe(course);
  });
});
