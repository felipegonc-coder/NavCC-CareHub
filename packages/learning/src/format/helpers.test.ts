import { describe, expect, it } from 'vitest';
import type { Course, CourseType, Question } from './index';
import {
  COURSE_TYPES,
  CourseSchema,
  CourseSettingsSchema,
  DEFAULT_ACKNOWLEDGEMENT,
  ID_PATTERN,
  QuizSettingsSchema,
  RichTextSchema,
  allQuestions,
  createCourse,
  isReservedId,
  newId,
  plainText,
  presetFor,
  richText,
} from './index';

describe('newId', () => {
  it('makes 16-character ids that match the id pattern', () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).toMatch(ID_PATTERN);
      expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(isReservedId(id)).toBe(false);
    }
  });

  it("doesn't repeat and uses every character", () => {
    const ids = Array.from({ length: 2000 }, () => newId());
    expect(new Set(ids).size).toBe(2000);
    expect(new Set(ids.join('')).size).toBe(62);
  });
});

describe('richText and plainText', () => {
  it('builds one paragraph per argument', () => {
    expect(richText()).toEqual([]);
    expect(richText('Hello', '')).toEqual([{ runs: [{ text: 'Hello' }] }, { runs: [] }]);
    expect(richText({ text: 'Bold', marks: ['bold'] })).toEqual([
      { runs: [{ text: 'Bold', marks: ['bold'] }] },
    ]);
    expect(
      richText([
        { text: 'Read ' },
        { text: 'the guide', link: { kind: 'page', pageId: 'sample-page-1' } },
      ]),
    ).toEqual([
      {
        runs: [
          { text: 'Read ' },
          { text: 'the guide', link: { kind: 'page', pageId: 'sample-page-1' } },
        ],
      },
    ]);
  });

  it('copies the runs it is given', () => {
    const run = { text: 'Hi' };
    const [paragraph] = richText(run);
    expect(paragraph?.runs[0]).not.toBe(run);
  });

  it('produces valid rich text', () => {
    expect(
      RichTextSchema.safeParse(richText('One', [{ text: 'Two', marks: ['italic'] }], '')).success,
    ).toBe(true);
  });

  it('flattens rich text to plain text', () => {
    expect(plainText(undefined)).toBe('');
    expect(plainText([])).toBe('');
    expect(
      plainText(
        richText([{ text: 'Call ' }, { text: 'back', marks: ['bold'] }], '', 'Line 1\nLine 2'),
      ),
    ).toBe('Call back\n\nLine 1\nLine 2');
  });
});

describe('allQuestions', () => {
  const question = (id: string): Question => ({
    id,
    type: 'true_false',
    prompt: richText(`Question ${id}`),
    points: 1,
    answer: true,
  });

  const course: Course = {
    ...createCourse({ type: 'standard', title: 'Phone basics', id: 'course-1' }),
    lessons: [
      {
        id: 'intro',
        kind: 'content',
        title: 'Intro',
        blocks: [
          { id: 'b1', type: 'heading', level: 1, text: 'Welcome' },
          { id: 'check-1', type: 'knowledge_check', question: question('kc'), allowRetry: true },
        ],
      },
      {
        id: 'quiz',
        kind: 'quiz',
        title: 'Final quiz',
        settings: presetFor('standard').quiz,
        questions: [question('q1'), question('q2')],
        bankDraws: [
          { bankId: 'bank-a', count: 1, questions: [question('bank-1')] },
          { bankId: 'bank-b', count: 2 },
        ],
      },
    ],
  };

  it('lists every question in reading order with where it lives', () => {
    const found = allQuestions(course);
    expect(
      found.map((entry) => [entry.question.id, entry.where, entry.lessonId, entry.path]),
    ).toEqual([
      ['kc', 'knowledge_check', 'intro', 'lessons[0].blocks[1].question'],
      ['q1', 'quiz', 'quiz', 'lessons[1].questions[0]'],
      ['q2', 'quiz', 'quiz', 'lessons[1].questions[1]'],
      ['bank-1', 'bank_draw', 'quiz', 'lessons[1].bankDraws[0].questions[0]'],
    ]);
    expect(found[0]).toMatchObject({
      where: 'knowledge_check',
      blockId: 'check-1',
      blockIndex: 1,
      lessonIndex: 0,
    });
    expect(found[3]).toMatchObject({
      where: 'bank_draw',
      bankId: 'bank-a',
      drawIndex: 0,
      questionIndex: 0,
      lessonIndex: 1,
    });
  });

  it('returns nothing for a course without questions', () => {
    expect(allQuestions(createCourse({ type: 'microlearning', title: 'Tiny' }))).toEqual([]);
  });
});

describe('presets', () => {
  const expected: Record<
    CourseType,
    {
      order: string;
      quizPass: boolean;
      acknowledgement: boolean;
      passMark: number;
      attempts: number | null;
      reveal: string;
      shuffle: boolean;
      certificate: number | null;
    }
  > = {
    standard: {
      order: 'free',
      quizPass: false,
      acknowledgement: false,
      passMark: 80,
      attempts: null,
      reveal: 'after_each_attempt',
      shuffle: false,
      certificate: null,
    },
    scenario_lab: {
      order: 'free',
      quizPass: false,
      acknowledgement: false,
      passMark: 70,
      attempts: null,
      reveal: 'after_each_attempt',
      shuffle: false,
      certificate: null,
    },
    required_read: {
      order: 'sequential',
      quizPass: true,
      acknowledgement: true,
      passMark: 100,
      attempts: null,
      reveal: 'after_passing',
      shuffle: false,
      certificate: null,
    },
    microlearning: {
      order: 'free',
      quizPass: false,
      acknowledgement: false,
      passMark: 80,
      attempts: null,
      reveal: 'after_each_attempt',
      shuffle: false,
      certificate: null,
    },
    certification: {
      order: 'sequential',
      quizPass: true,
      acknowledgement: false,
      passMark: 90,
      attempts: 3,
      reveal: 'after_final_attempt',
      shuffle: true,
      certificate: 12,
    },
  };

  for (const type of COURSE_TYPES) {
    it(`matches the preset table for ${type}`, () => {
      const { settings, quiz } = presetFor(type);
      const want = expected[type];
      expect(settings.lessonOrder).toBe(want.order);
      expect(settings.completion).toEqual({
        requireAllLessons: true,
        requireQuizPass: want.quizPass,
        requireAcknowledgement: want.acknowledgement,
      });
      expect(settings.acknowledgement).toEqual(
        want.acknowledgement ? { statement: DEFAULT_ACKNOWLEDGEMENT } : undefined,
      );
      expect(settings.catalog).toEqual({ listed: true });
      expect(settings.certificate).toEqual(
        want.certificate === null
          ? { enabled: false }
          : { enabled: true, validForMonths: want.certificate },
      );
      expect(quiz).toEqual({
        passMark: want.passMark,
        maxAttempts: want.attempts,
        shuffleQuestions: want.shuffle,
        shuffleOptions: want.shuffle,
        revealAnswers: want.reveal,
      });
      expect(CourseSettingsSchema.safeParse(settings).success).toBe(true);
      expect(QuizSettingsSchema.safeParse(quiz).success).toBe(true);
    });
  }

  it('asks standard courses for a quiz pass only when they have a quiz', () => {
    expect(presetFor('standard', { hasQuiz: true }).settings.completion.requireQuizPass).toBe(true);
    expect(presetFor('standard', { hasQuiz: false }).settings.completion.requireQuizPass).toBe(
      false,
    );
    expect(presetFor('scenario_lab', { hasQuiz: true }).settings.completion.requireQuizPass).toBe(
      false,
    );
  });

  it('returns fresh objects every time', () => {
    const first = presetFor('certification');
    first.settings.completion.requireAllLessons = false;
    first.quiz.passMark = 1;
    expect(presetFor('certification').settings.completion.requireAllLessons).toBe(true);
    expect(presetFor('certification').quiz.passMark).toBe(90);
  });
});

describe('createCourse', () => {
  for (const type of COURSE_TYPES) {
    it(`creates a valid ${type} draft`, () => {
      const course = createCourse({ type, title: 'Handling complaints' });
      expect(CourseSchema.safeParse(course).success).toBe(true);
      expect(course).toMatchObject({
        formatVersion: 1,
        title: 'Handling complaints',
        type,
        settings: presetFor(type).settings,
      });
      expect(course.id).toMatch(/^[A-Za-z0-9]{16}$/);
    });
  }

  it('starts microlearning with one lesson named after the course', () => {
    const course = createCourse({ type: 'microlearning', title: 'Two-minute tip', id: 'tip-1' });
    expect(course.id).toBe('tip-1');
    expect(course.lessons).toHaveLength(1);
    expect(course.lessons[0]).toMatchObject({
      kind: 'content',
      title: 'Two-minute tip',
      blocks: [],
    });
    expect(createCourse({ type: 'standard', title: 'x' }).lessons).toEqual([]);
  });

  it('tidies the title', () => {
    expect(createCourse({ type: 'standard', title: '  Spaced out  ' }).title).toBe('Spaced out');
    expect(createCourse({ type: 'standard', title: '   ' }).title).toBe('Untitled course');
    expect(createCourse({ type: 'standard', title: 'x'.repeat(250) }).title).toHaveLength(200);
  });
});
