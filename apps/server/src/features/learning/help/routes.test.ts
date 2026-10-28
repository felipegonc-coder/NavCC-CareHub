import { randomUUID } from 'node:crypto';
import { CLAUDE_ERRORS, type ClaudeErrorReason } from '@carehub/extras/claude';
import {
  blockHelpText,
  createCourse,
  HELP_SYSTEM,
  HelpQuestionDraftsSchema,
  HelpSummarySchema,
  presetFor,
  QuestionSchema,
  richText,
  type Course,
} from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase } from '../../../testing';
import { ClaudeError } from '../../claude/index';
import { getStudioCourse } from '../courses/service';
import { httpError } from '../errors';
import helpRoutes from './routes';

// The shared Claude client and the saved draft are stubbed: these tests check what the routes send to
// Claude and what they answer. Fictional people and course text only.
const claude = vi.hoisted(() => ({
  askClaude: vi.fn(),
  askClaudeJson: vi.fn(),
  isClaudeFeatureOn: vi.fn(),
}));
vi.mock('../../claude/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../claude/index')>()),
  ...claude,
}));
vi.mock('../courses/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../courses/service')>()),
  getStudioCourse: vi.fn(),
}));

// The draft comes from the stubbed getStudioCourse, so no database is used.
const db = {} as Db;
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: { id: randomUUID(), permissions: ['learning.build'] },
  learner: { id: randomUUID(), permissions: [] },
};
type Person = keyof typeof PEOPLE;

const course: Course = {
  ...createCourse({ type: 'standard', title: 'Billing calls' }),
  lessons: [
    {
      id: 'lesson-1',
      kind: 'content',
      title: 'Opening the call',
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          text: richText('Greet the caller and say your name.', 'Ask how you can help today.'),
        },
        { id: 'block-2', type: 'paragraph', text: [] },
      ],
    },
    { id: 'lesson-2', kind: 'content', title: 'Notes', blocks: [] },
    {
      id: 'lesson-3',
      kind: 'quiz',
      title: 'Check',
      intro: richText('One quick question.'),
      settings: { ...presetFor('standard').quiz },
      questions: [
        {
          id: 'question-1',
          type: 'true_false',
          prompt: richText('You give your name first.'),
          points: 1,
          answer: true,
        },
      ],
    },
  ],
};
const [lesson] = course.lessons;
const block = lesson?.kind === 'content' ? lesson.blocks[0] : undefined;
const TEXT = block ? blockHelpText(block) : '';
const TITLE = 'Billing calls, lesson 1: Opening the call';
const STALE = 'This course changed since you opened it. Reload, then try again.';

const refusal = (reason: ClaudeErrorReason) => {
  const { code, message } = CLAUDE_ERRORS[reason];
  return { error: { code, message, details: { reason } } };
};

let app: FastifyInstance;
const logs: string[] = [];

beforeAll(async () => {
  app = Fastify({
    logger: { level: 'error', stream: { write: (line: string) => logs.push(line) } },
  });
  app.decorate('db', db);
  app.decorateRequest('user', null);
  app.decorateRequest('member', null);
  app.addHook('onRequest', async (request) => {
    const person = PEOPLE[request.headers['x-test-person'] as Person];
    if (!person) return;
    Object.assign(request, {
      user: { id: person.id },
      member: { workspaceId, roleId: 'role-test', permissions: new Set(person.permissions) },
    });
  });
  await app.register(helpRoutes, { prefix: '/api/learning/help' });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  logs.length = 0;
  vi.mocked(getStudioCourse).mockReset();
  vi.mocked(getStudioCourse).mockResolvedValue({ course, revision: 3, liveVersion: null });
  claude.askClaude.mockReset();
  claude.askClaude.mockResolvedValue({ text: 'Say hello, then give your name.' });
  claude.askClaudeJson.mockReset();
  claude.isClaudeFeatureOn.mockReset();
  claude.isClaudeFeatureOn.mockResolvedValue(true);
});

const post = (path: string, body: object, person: Person | null = 'trainer') =>
  app.inject({
    method: 'POST',
    url: `/api/learning/help/${path}`,
    headers: person ? { 'x-test-person': person } : {},
    payload: { courseId: course.id, revision: 3, ...body },
  });

describe('Learning help: writing help', () => {
  const write = (body: object, person: Person | null = 'trainer') =>
    post('write', { lessonId: 'lesson-1', blockId: 'block-1', action: 'improve', ...body }, person);

  const sent = () => claude.askClaude.mock.calls[0]?.[1];

  it('sends Claude the saved block text and the selection cut on the server', async () => {
    const response = await write({ selection: { start: 0, end: 35 } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'Say hello, then give your name.' });
    expect(getStudioCourse).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: PEOPLE.trainer.id, workspaceId }),
      course.id,
    );
    expect(claude.askClaude).toHaveBeenCalledTimes(1);
    expect(Object.keys(sent()).sort()).toEqual(
      [
        'documents',
        'feature',
        'instruction',
        'selection',
        'system',
        'userId',
        'workspaceId',
      ].sort(),
    );
    expect(sent()).toMatchObject({
      workspaceId,
      userId: PEOPLE.trainer.id,
      feature: 'learning_help',
      system: HELP_SYSTEM,
      documents: [{ title: TITLE, text: TEXT }],
      selection: 'Greet the caller and say your name.',
    });
    expect(sent().instruction).toContain('the selection');
  });

  it('works on the whole block without a selection, and continues from the end of one', async () => {
    expect((await write({})).statusCode).toBe(200);
    expect(sent().documents).toEqual([{ title: TITLE, text: TEXT }]);
    expect('selection' in sent()).toBe(false);

    claude.askClaude.mockClear();
    expect((await write({ action: 'continue', selection: { start: 0, end: 16 } })).statusCode).toBe(
      200,
    );
    expect(sent().documents).toEqual([{ title: TITLE, text: 'Greet the caller' }]);
    expect('selection' in sent()).toBe(false);
  });

  it('lets in only builders, and only for a saved draft they can open', async () => {
    expect((await write({}, null)).statusCode).toBe(401);
    expect((await write({}, 'learner')).statusCode).toBe(403);

    vi.mocked(getStudioCourse).mockRejectedValueOnce(httpError(404));
    expect((await write({})).statusCode).toBe(404);
    expect((await write({ lessonId: 'lesson-9' })).statusCode).toBe(404);
    expect((await write({ blockId: 'block-9' })).statusCode).toBe(404);

    const stale = await write({ revision: 2 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: { code: 'conflict', message: STALE } });
    expect(claude.askClaude).not.toHaveBeenCalled();
  });

  it('refuses selections outside the block, blank text and a tone without Change tone', async () => {
    const outside = await write({ selection: { start: 0, end: TEXT.length + 1 } });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.message).toBe('Select text in this block, then try again.');
    const blank = await write({ selection: { start: 35, end: 37 } });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error.message).toBe("There's no text here to work on yet.");
    expect((await write({ blockId: 'block-2' })).statusCode).toBe(400);
    expect((await write({ tone: 'friendly' })).statusCode).toBe(400);
    expect(claude.askClaude).not.toHaveBeenCalled();
  });

  it("answers the shared client's refusals with their status, words and reason", async () => {
    for (const reason of ['switched_off', 'no_permission', 'too_long', 'monthly_cap'] as const) {
      claude.askClaude.mockRejectedValueOnce(new ClaudeError(reason));
      const response = await write({});
      expect(response.statusCode).toBe(CLAUDE_ERRORS[reason].status);
      expect(response.json()).toEqual(refusal(reason));
    }
  });

  it('drops an answer that comes back after the switch went off, or that is empty', async () => {
    claude.isClaudeFeatureOn.mockResolvedValueOnce(false);
    const off = await write({});
    expect(off.statusCode).toBe(409);
    expect(off.json()).toEqual(refusal('switched_off'));

    claude.askClaude.mockResolvedValueOnce({ text: '```\n```' });
    expect((await write({})).json()).toEqual(refusal('bad_output'));
  });

  it('logs only the status and the type of an unexpected error', async () => {
    vi.mocked(getStudioCourse).mockRejectedValueOnce(new Error('Greet the caller'));
    const response = await write({});
    expect(response.statusCode).toBe(500);
    const failed = logs.filter((line) => line.includes('Learning help request failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('"status":500');
    expect(failed[0]).toContain('"type":"Error"');
    expect(logs.join('\n')).not.toContain('Greet the caller');
  });
});

describe('Learning help: summary and key points', () => {
  const answer = { summary: 'Greet callers by name.', keyPoints: ['Say your name first.'] };
  const sent = () => claude.askClaudeJson.mock.calls[0]?.[1];
  const lessonOne = { title: TITLE, text: TEXT };
  const quiz = {
    title: 'Billing calls, lesson 3: Check',
    text: 'One quick question.\n\nYou give your name first.',
  };

  beforeEach(() => {
    claude.askClaudeJson.mockResolvedValue({ data: answer });
  });

  it('summarizes the course from every lesson with text, as JSON checked by the schema', async () => {
    const response = await post('summary', {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(answer);
    expect(Object.keys(sent()).sort()).toEqual(
      ['documents', 'feature', 'instruction', 'schema', 'system', 'userId', 'workspaceId'].sort(),
    );
    expect(sent()).toMatchObject({
      workspaceId,
      userId: PEOPLE.trainer.id,
      feature: 'learning_help',
      system: HELP_SYSTEM,
      documents: [lessonOne, quiz],
    });
    expect(sent().schema).toBe(HelpSummarySchema);
    expect(sent().instruction).toContain('each document is one lesson');
  });

  it('summarizes one lesson, and refuses an unknown or empty one or a stale draft', async () => {
    expect((await post('summary', { lessonId: 'lesson-1' })).statusCode).toBe(200);
    expect(sent().documents).toEqual([lessonOne]);
    expect(sent().instruction).toContain('this lesson');

    claude.askClaudeJson.mockClear();
    expect((await post('summary', { lessonId: 'lesson-9' })).statusCode).toBe(404);
    const empty = await post('summary', { lessonId: 'lesson-2' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toBe("There's no text here to summarize yet.");
    expect((await post('summary', { revision: 4 })).statusCode).toBe(409);
    expect((await post('summary', {}, 'learner')).statusCode).toBe(403);
    expect(claude.askClaudeJson).not.toHaveBeenCalled();
  });

  it("answers the shared client's refusals with their reason", async () => {
    claude.askClaudeJson.mockRejectedValueOnce(new ClaudeError('bad_output'));
    const response = await post('summary', {});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(refusal('bad_output'));
  });
});

describe('Learning help: quiz questions', () => {
  const sent = () => claude.askClaudeJson.mock.calls[0]?.[1];
  const options = (first: boolean, second: boolean) => [
    { text: 'Your name', correct: first },
    { text: 'The price', correct: second },
  ];
  const drafts = [
    { type: 'single_choice', prompt: 'What do you say first?', options: options(true, false) },
    { type: 'single_choice', prompt: 'Two right answers?', options: options(true, true) },
    { type: 'true_false', prompt: 'You give your name first.', answer: true },
    { type: 'multiple_choice', prompt: 'Not asked for', options: options(true, true) },
  ];

  beforeEach(() => {
    claude.askClaudeJson.mockResolvedValue({ data: { questions: drafts } });
  });

  it('sends one lesson and returns only checked questions of the types asked for', async () => {
    const response = await post('questions', {
      lessonId: 'lesson-1',
      count: 4,
      types: ['single_choice', 'true_false'],
    });
    expect(response.statusCode).toBe(200);
    expect(sent()).toMatchObject({
      feature: 'learning_help',
      system: HELP_SYSTEM,
      documents: [{ title: TITLE, text: TEXT }],
    });
    expect(sent().schema).toBe(HelpQuestionDraftsSchema);
    expect(sent().instruction).toContain('Write 4 quiz questions');
    expect(sent().instruction).not.toContain('multiple choice');

    const { questions } = response.json();
    expect(questions.map((question: { type: string }) => question.type)).toEqual([
      'single_choice',
      'true_false',
    ]);
    for (const question of questions) expect(QuestionSchema.safeParse(question).success).toBe(true);
    expect(new Set(questions.map((question: { id: string }) => question.id)).size).toBe(2);
  });

  it('refuses an unknown or empty lesson and too many questions', async () => {
    expect((await post('questions', { lessonId: 'lesson-9' })).statusCode).toBe(404);
    const empty = await post('questions', { lessonId: 'lesson-2' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toBe("There's no text here to write questions about yet.");
    expect((await post('questions', { lessonId: 'lesson-1', count: 11 })).statusCode).toBe(400);
    expect(claude.askClaudeJson).not.toHaveBeenCalled();
  });

  it('answers bad_output when no question passes the checks', async () => {
    claude.askClaudeJson.mockResolvedValueOnce({ data: { questions: [drafts[1]] } });
    const response = await post('questions', { lessonId: 'lesson-1' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(refusal('bad_output'));
  });
});

describe.skipIf(!hasDatabase)('Learning help: mount', () => {
  it('answers under /api/learning/help', async () => {
    const server = await createTestApp();
    try {
      const response = await server.app.inject({ method: 'POST', url: '/api/learning/help/write' });
      expect(response.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
