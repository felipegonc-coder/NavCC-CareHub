import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type * as F from './index';
import {
  BLOCK_TYPES,
  BlockSchema,
  ButtonTargetSchema,
  CourseFileSchema,
  CourseSchema,
  EmbedBlockSchema,
  ExternalIdSchema,
  IdSchema,
  IsoDateSchema,
  LearningPathSchema,
  LIMITS,
  LinkSchema,
  MediaRefSchema,
  QUESTION_TYPES,
  QuestionResponseSchema,
  QuestionSchema,
  RESERVED_IDS,
  RichTextSchema,
  VideoBlockSchema,
  isHttpsUrl,
  isReservedId,
  richTextLength,
} from './index';

// ---------- Fictional samples ----------
const rt = (text: string): F.RichText => [{ runs: [{ text }] }];
const image: F.Image = {
  media: { kind: 'file', fileId: 'sample-image-1' },
  alt: 'A support agent wearing a headset',
};

const questionSamples: { [T in F.QuestionType]: Extract<F.Question, { type: T }> } = {
  single_choice: {
    id: 'q-single',
    type: 'single_choice',
    prompt: rt('Which greeting is best?'),
    points: 1,
    options: [
      {
        id: 'o1',
        text: 'Hi, this is Sam from Care Hub. How can I help?',
        correct: true,
        feedback: rt('Clear and friendly.'),
      },
      { id: 'o2', text: 'Yes?', correct: false },
    ],
  },
  multiple_choice: {
    id: 'q-multiple',
    type: 'multiple_choice',
    prompt: rt('Which details confirm who you are talking to?'),
    image,
    points: 2,
    feedback: { correct: rt('Right.'), incorrect: rt('Check the lesson again.') },
    options: [
      { id: 'o1', text: 'Date of birth', correct: true },
      { id: 'o2', text: 'Postcode', correct: true },
      { id: 'o3', text: 'Favourite colour', correct: false },
    ],
  },
  true_false: {
    id: 'q-true-false',
    type: 'true_false',
    prompt: rt("You may share a member's details with their neighbour."),
    points: 1,
    answer: false,
    feedbackTrue: rt('Only with consent on file.'),
    feedbackFalse: rt('Correct: never without consent.'),
  },
  matching: {
    id: 'q-matching',
    type: 'matching',
    prompt: rt('Match each term to its meaning.'),
    points: 2,
    pairs: [
      { id: 'p1', prompt: 'SLA', match: 'Service level agreement' },
      { id: 'p2', prompt: 'CSAT', match: 'Customer satisfaction score' },
    ],
  },
  drag_matching: {
    id: 'q-drag',
    type: 'drag_matching',
    prompt: rt('Drag each channel to its reply time.'),
    points: 2,
    pairs: [
      { id: 'p1', prompt: 'Phone', match: 'Right away' },
      { id: 'p2', prompt: 'Email', match: 'Within one day' },
    ],
  },
  fill_blank: {
    id: 'q-fill',
    type: 'fill_blank',
    prompt: rt('Complete the sentence.'),
    points: 1,
    parts: [
      { kind: 'text', text: 'Call back within ' },
      { kind: 'blank', id: 'hours', answers: ['24', 'twenty-four'], caseSensitive: false },
      { kind: 'text', text: ' hours.' },
    ],
  },
  ordering: {
    id: 'q-ordering',
    type: 'ordering',
    prompt: rt('Put the steps in order.'),
    points: 1,
    items: [
      { id: 'greet', text: 'Greet' },
      { id: 'listen', text: 'Listen' },
      { id: 'resolve', text: 'Resolve' },
    ],
  },
  hotspot: {
    id: 'q-hotspot',
    type: 'hotspot',
    prompt: rt('Select the mute button.'),
    points: 1,
    image,
    spots: [
      {
        id: 'mute',
        shape: 'rect',
        x: 10,
        y: 10,
        width: 20,
        height: 10,
        correct: true,
        label: 'Mute button',
      },
      {
        id: 'end',
        shape: 'ellipse',
        x: 60,
        y: 10,
        width: 20,
        height: 20,
        correct: false,
        label: 'End call button',
      },
    ],
  },
};

const blockSamples: { [T in F.BlockType]: Extract<F.Block, { type: T }> } = {
  heading: { id: 'b-heading', type: 'heading', level: 2, text: 'Welcome' },
  paragraph: {
    id: 'b-paragraph',
    type: 'paragraph',
    text: [
      {
        runs: [
          { text: 'Read the ' },
          {
            text: 'call guide',
            marks: ['bold', 'underline'],
            link: { kind: 'url', url: 'https://help.example.org/guide' },
          },
          { text: ' or email ' },
          { text: 'the team', link: { kind: 'url', url: 'mailto:team@example.org' } },
          { text: '.\nThen see ' },
          {
            text: 'the next lesson',
            link: { kind: 'lesson', lessonId: 'lesson-2', blockId: 'b-heading' },
          },
          { text: ' and ' },
          { text: 'the handbook', link: { kind: 'page', pageId: 'sample-page-1' } },
        ],
      },
    ],
  },
  list: {
    id: 'b-list',
    type: 'list',
    style: 'checkbox',
    items: [
      { id: 'i1', text: rt('Listen') },
      { id: 'i2', text: rt('Confirm') },
    ],
  },
  callout: {
    id: 'b-callout',
    type: 'callout',
    tone: 'tip',
    title: 'Tip',
    text: rt('Smile while you talk; people can hear it.'),
  },
  statement: {
    id: 'b-statement',
    type: 'statement',
    text: 'Every caller leaves with a clear next step.',
  },
  quote: {
    id: 'b-quote',
    type: 'quote',
    text: 'Kindness is a skill you can practise.',
    attribution: 'Rosa Ortega, team lead',
    background: image,
  },
  quote_carousel: {
    id: 'b-quotes',
    type: 'quote_carousel',
    quotes: [
      { id: 'quote-1', text: 'They listened.' },
      { id: 'quote-2', text: 'Quick and kind.', attribution: 'A fictional member' },
    ],
  },
  two_column: {
    id: 'b-columns',
    type: 'two_column',
    left: rt('Do: use their name.'),
    right: rt("Don't: rush them."),
  },
  divider: { id: 'b-divider', type: 'divider', style: 'numbered' },
  code: { id: 'b-code', type: 'code', language: 'text', code: 'Ticket CH-1234: call back by 3 pm' },
  table: {
    id: 'b-table',
    type: 'table',
    headerRow: true,
    rows: [
      ['Channel', 'Reply within'],
      ['Phone', 'Right away'],
    ],
  },
  image: {
    id: 'b-image',
    type: 'image',
    image,
    size: 'medium',
    layout: 'image_and_text',
    text: rt('The front desk.'),
  },
  gallery: {
    id: 'b-gallery',
    type: 'gallery',
    layout: 'grid',
    images: [
      image,
      {
        media: { kind: 'url', url: 'https://cdn.example.org/desk.png' },
        alt: '',
        decorative: true,
        caption: 'Desk',
      },
    ],
  },
  labeled_graphic: {
    id: 'b-graphic',
    type: 'labeled_graphic',
    image,
    markers: [{ id: 'm1', x: 0, y: 100, title: 'Phone', text: rt('Answer within three rings.') }],
  },
  video: {
    id: 'b-video',
    type: 'video',
    media: { kind: 'url', url: 'https://video.example.org/welcome' },
    title: 'Welcome video',
    captions: [
      { fileId: 'sample-captions-en', language: 'en', label: 'English' },
      { fileId: 'sample-captions-es', language: 'es-MX' },
    ],
    transcript: rt('Hello and welcome.'),
  },
  audio: {
    id: 'b-audio',
    type: 'audio',
    media: { kind: 'file', fileId: 'sample-audio-1' },
    title: 'A sample call',
    transcript: rt('Thanks for calling.'),
  },
  file: {
    id: 'b-file',
    type: 'file',
    fileId: 'sample-file-1',
    name: 'Call checklist.pdf',
    description: 'Print it and keep it at your desk.',
  },
  embed: {
    id: 'b-embed',
    type: 'embed',
    url: 'https://forms.example.org/feedback',
    title: 'Feedback form',
    height: 600,
  },
  accordion: {
    id: 'b-accordion',
    type: 'accordion',
    items: [{ id: 'a1', title: 'What if the line drops?', body: rt('Call back once.') }],
  },
  tabs: {
    id: 'b-tabs',
    type: 'tabs',
    tabs: [
      { id: 't1', title: 'Phone', body: rt('Greet, listen, resolve.') },
      { id: 't2', title: 'Chat', body: rt('Reply within two minutes.') },
    ],
  },
  timeline: {
    id: 'b-timeline',
    type: 'timeline',
    items: [
      { id: 'e1', label: 'Day 1', title: 'Shadowing' },
      { id: 'e2', label: 'Day 2', title: 'First calls', body: rt('With a buddy.') },
    ],
  },
  process: {
    id: 'b-process',
    type: 'process',
    intro: { title: 'Five steps' },
    steps: [
      { id: 's1', title: 'Greet', body: rt('Say your name.'), image },
      { id: 's2', title: 'Listen', body: rt('Let them finish.') },
    ],
    summary: { title: 'Done', body: rt('That is the whole call.') },
  },
  flashcards: {
    id: 'b-cards',
    type: 'flashcards',
    cards: [
      {
        id: 'c1',
        front: 'SLA',
        back: 'Service level agreement',
        frontImage: image,
        backImage: image,
      },
    ],
  },
  sorting: {
    id: 'b-sorting',
    type: 'sorting',
    categories: [
      { id: 'today', title: 'Same day' },
      { id: 'later', title: 'Can wait' },
    ],
    items: [
      { id: 'x1', text: 'Cannot log in to the member portal', categoryId: 'today' },
      { id: 'x2', text: 'Wants a printed brochure', categoryId: 'later' },
    ],
  },
  button: {
    id: 'b-button',
    type: 'button',
    label: 'Open the handbook',
    description: 'Opens in a new tab.',
    target: { kind: 'page', pageId: 'sample-page-1' },
  },
  continue: { id: 'b-continue', type: 'continue', label: 'Next part', requires: 'complete_above' },
  knowledge_check: {
    id: 'b-check',
    type: 'knowledge_check',
    question: { ...questionSamples.true_false, id: 'q-check' },
    allowRetry: true,
  },
  scenario: {
    id: 'b-scenario',
    type: 'scenario',
    title: 'An upset caller',
    intro: rt('Jordan is calling about a late reply.'),
    characters: [{ id: 'jordan', name: 'Jordan Avery', role: 'Member', avatar: image }],
    startSceneId: 'start',
    scenes: [
      {
        id: 'start',
        speakerId: 'jordan',
        text: 'I have been waiting a week for an answer!',
        choices: [
          {
            id: 'calm',
            text: "I'm sorry for the wait. Let's sort it out now.",
            points: 10,
            coaching: rt('Acknowledge first.'),
            next: { kind: 'scene', sceneId: 'good' },
          },
          { id: 'policy', text: 'That is our policy.', points: -10, next: { kind: 'retry' } },
          {
            id: 'review',
            text: 'Review the lesson first',
            points: 0,
            next: { kind: 'lesson', lessonId: 'lesson-1' },
          },
        ],
      },
      {
        id: 'good',
        text: 'Jordan relaxes.',
        choices: [],
        ending: { outcome: 'great', title: 'Well handled', text: rt('You calmed things down.') },
      },
    ],
    passScore: 5,
  },
};

function sampleCourse(): F.Course {
  return {
    formatVersion: 1,
    id: 'course-phone-basics',
    title: 'Phone basics',
    summary: 'Answer calls with confidence.',
    description: rt('A short course for new team members.'),
    cover: image,
    coverLayout: 'split',
    type: 'standard',
    topics: ['Phones', 'Onboarding'],
    estimatedMinutes: 20,
    settings: {
      lessonOrder: 'sequential',
      completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: true },
      minimumCourseSeconds: 600,
      acknowledgement: { statement: 'I have read and understood the phone guide.' },
      catalog: { listed: true },
      certificate: { enabled: true, validForMonths: 12 },
      sidebar: 'open',
      labels: { start: 'Begin', submit: 'Send answers' },
      reviewEveryMonths: 12,
    },
    lessons: [
      {
        id: 'lesson-1',
        kind: 'content',
        title: 'Greeting',
        icon: '👋',
        headerImage: image,
        minimumSeconds: 60,
        blocks: Object.values(blockSamples),
      },
      {
        id: 'lesson-2',
        kind: 'quiz',
        title: 'Check your knowledge',
        intro: rt('Five questions. You need 80 % to pass.'),
        settings: {
          passMark: 80,
          maxAttempts: null,
          shuffleQuestions: true,
          shuffleOptions: true,
          poolSize: 5,
          revealAnswers: 'after_each_attempt',
          mode: 'graded',
        },
        questions: Object.values(questionSamples),
        bankDraws: [
          {
            bankId: 'bank-phone',
            count: 1,
            questions: [{ ...questionSamples.single_choice, id: 'q-bank-1' }],
          },
        ],
      },
    ],
  };
}

// ---------- Helpers ----------
type Issue = { path: string; code: string; message: string };

function issuesOf(schema: z.ZodType, value: unknown): Issue[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      }));
}

/** A copy of `value` without `key`. */
function without<T extends object>(value: T, key: keyof T & string): Record<string, unknown> {
  const copy: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  delete copy[key];
  return copy;
}

function accepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

const withSettings = (settings: Partial<F.CourseSettings>): unknown => {
  const course = sampleCourse();
  return { ...course, settings: { ...course.settings, ...settings } };
};

const quizLesson = (course: F.Course): F.QuizLesson => {
  const lesson = course.lessons.find((l): l is F.QuizLesson => l.kind === 'quiz');
  if (!lesson) throw new Error('sample course has no quiz lesson');
  return lesson;
};

const withQuiz = (change: (quiz: F.QuizLesson) => unknown): unknown => {
  const course = sampleCourse();
  const quiz = quizLesson(course);
  return {
    ...course,
    lessons: course.lessons.map((lesson) => (lesson === quiz ? change(quiz) : lesson)),
  };
};

// ---------- Tests ----------
describe('samples', () => {
  for (const type of BLOCK_TYPES) {
    it(`accepts a ${type} block and keeps it unchanged`, () => {
      const result = BlockSchema.safeParse(blockSamples[type]);
      expect(result.success).toBe(true);
      expect(result.data).toStrictEqual(blockSamples[type]);
    });
  }

  for (const type of QUESTION_TYPES) {
    it(`accepts a ${type} question and keeps it unchanged`, () => {
      const result = QuestionSchema.safeParse(questionSamples[type]);
      expect(result.success).toBe(true);
      expect(result.data).toStrictEqual(questionSamples[type]);
    });
  }

  it('accepts a course that uses every optional field', () => {
    const course = sampleCourse();
    expect(issuesOf(CourseSchema, course)).toEqual([]);
    expect(CourseSchema.parse(course)).toStrictEqual(course);
  });

  it('accepts half-finished drafts (completeness is a publish check)', () => {
    const draft = {
      formatVersion: 1,
      id: 'draft-1',
      title: 'Untitled course',
      type: 'microlearning',
      settings: {
        lessonOrder: 'free',
        completion: {
          requireAllLessons: false,
          requireQuizPass: false,
          requireAcknowledgement: false,
        },
        catalog: { listed: false },
        certificate: { enabled: false },
      },
      lessons: [
        {
          id: 'l1',
          kind: 'content',
          title: 'Lesson 1',
          blocks: [{ id: 'b1', type: 'list', style: 'bulleted', items: [] }],
        },
        {
          id: 'l2',
          kind: 'quiz',
          title: 'Quiz',
          settings: {
            passMark: 80,
            maxAttempts: 3,
            shuffleQuestions: false,
            shuffleOptions: false,
            revealAnswers: 'never',
          },
          questions: [
            {
              id: 'q1',
              type: 'single_choice',
              prompt: [],
              options: [{ id: 'o1', text: '', correct: false }],
            },
          ],
        },
      ],
    };
    expect(issuesOf(CourseSchema, draft)).toEqual([]);
  });
});

describe('structure', () => {
  it('rejects unknown keys at every level', () => {
    const course = sampleCourse();
    expect(issuesOf(CourseSchema, { ...course, html: '<b>hi</b>' })).toEqual([
      { path: '', code: 'unrecognized_keys', message: 'Unrecognized key: "html"' },
    ]);
    expect(issuesOf(BlockSchema, { ...blockSamples.heading, color: 'red' })[0]?.code).toBe(
      'unrecognized_keys',
    );
    expect(
      issuesOf(RichTextSchema, [{ runs: [{ text: 'Hi', style: 'color: red' }] }])[0],
    ).toMatchObject({ path: '0.runs.0', code: 'unrecognized_keys' });
    expect(
      issuesOf(
        CourseSchema,
        withSettings({ labels: { start: 'Go', finish: 'Done' } as F.CourseSettings['labels'] }),
      )[0]?.path,
    ).toBe('settings.labels');
  });

  it('rejects unknown block, question and course types', () => {
    expect(accepts(BlockSchema, { id: 'b1', type: 'html', html: '<script></script>' })).toBe(false);
    expect(accepts(QuestionSchema, { id: 'q1', type: 'essay', prompt: [] })).toBe(false);
    expect(accepts(CourseSchema, { ...sampleCourse(), type: 'webinar' })).toBe(false);
  });

  it('gives questions 1 point when points is missing', () => {
    expect(QuestionSchema.parse(without(questionSamples.ordering, 'points')).points).toBe(1);
    expect(accepts(QuestionSchema, { ...questionSamples.ordering, points: 0 })).toBe(false);
    expect(accepts(QuestionSchema, { ...questionSamples.ordering, points: 101 })).toBe(false);
    expect(accepts(QuestionSchema, { ...questionSamples.ordering, points: 1.5 })).toBe(false);
  });

  it('only accepts the current formatVersion (older ones go through the migrations)', () => {
    expect(accepts(CourseSchema, { ...sampleCourse(), formatVersion: 2 })).toBe(false);
    expect(accepts(CourseSchema, { ...sampleCourse(), formatVersion: '1' })).toBe(false);
    expect(accepts(CourseSchema, without(sampleCourse(), 'formatVersion'))).toBe(false);
  });

  it('requires a hotspot question image (other questions may skip it)', () => {
    expect(issuesOf(QuestionSchema, without(questionSamples.hotspot, 'image'))[0]?.path).toBe(
      'image',
    );
  });
});

describe('ids', () => {
  it('accepts 1 to 64 letters, digits, _ and -', () => {
    for (const id of ['a', 'Z', '0', 'lesson-1', 'q_2', 'A-b_9', 'x'.repeat(64)])
      expect(accepts(IdSchema, id)).toBe(true);
    for (const id of ['', 'x'.repeat(65), 'has space', 'émile', 'a.b', 'a/b', 'a:b', 7])
      expect(accepts(IdSchema, id)).toBe(false);
  });

  it('rejects ids that clash with built-in object properties', () => {
    for (const id of RESERVED_IDS) {
      expect(isReservedId(id)).toBe(true);
      expect(issuesOf(IdSchema, id)[0]?.message).toBe('This id is reserved; choose another.');
    }
    expect(isReservedId('lesson-1')).toBe(false);
    expect(isReservedId('proto')).toBe(false);
  });

  it('accepts external file and page ids', () => {
    for (const id of [
      'sample-file-1',
      'files:abc.def',
      'A',
      '0f9e8d7c-6b5a-4321-8765-0fedcba98765',
      'x'.repeat(200),
    ]) {
      expect(accepts(ExternalIdSchema, id)).toBe(true);
    }
    for (const id of ['', '-x', '.hidden', '../etc', 'a b', 'a/b', 'x'.repeat(201)])
      expect(accepts(ExternalIdSchema, id)).toBe(false);
  });
});

describe('links and media', () => {
  it('accepts only full https addresses for media and embeds', () => {
    for (const url of [
      'https://example.org',
      'https://example.org/a?b=c#d',
      'HTTPS://EXAMPLE.ORG/x',
      'https://例え.jp/',
    ]) {
      expect(isHttpsUrl(url)).toBe(true);
    }
    for (const url of [
      'http://example.org',
      'javascript:alert(1)',
      'data:text/html,hi',
      '//example.org',
      'https://',
      'https:///path',
      'https://\\example.org',
      'https://someone@example.org',
      'https://exa mple.org',
      ' https://example.org',
      'ftp://example.org',
      'example.org',
    ]) {
      expect(isHttpsUrl(url)).toBe(false);
    }
    expect(accepts(MediaRefSchema, { kind: 'url', url: 'mailto:team@example.org' })).toBe(false);
    expect(
      accepts(EmbedBlockSchema, { ...blockSamples.embed, url: 'mailto:team@example.org' }),
    ).toBe(false);
    expect(
      accepts(MediaRefSchema, {
        kind: 'url',
        url: `https://example.org/${'a'.repeat(LIMITS.url)}`,
      }),
    ).toBe(false);
  });

  it('accepts https and mailto for links and buttons', () => {
    for (const url of [
      'https://example.org',
      'mailto:team@example.org',
      'MAILTO:team@example.org',
    ]) {
      expect(accepts(LinkSchema, { kind: 'url', url })).toBe(true);
      expect(accepts(ButtonTargetSchema, { kind: 'url', url })).toBe(true);
    }
    for (const url of ['mailto:', 'javascript:alert(1)', 'http://example.org', 'tel:+15550100']) {
      expect(accepts(LinkSchema, { kind: 'url', url })).toBe(false);
    }
    expect(issuesOf(LinkSchema, { kind: 'url', url: 'http://example.org' })[0]?.message).toBe(
      'Use a full https:// or mailto: address.',
    );
  });

  it('checks caption language tags', () => {
    const withLanguage = (language: string) => ({
      ...blockSamples.video,
      captions: [{ fileId: 'sample-captions', language }],
    });
    for (const language of ['en', 'es-MX', 'zh-Hant-TW', 'haw'])
      expect(accepts(VideoBlockSchema, withLanguage(language))).toBe(true);
    for (const language of ['', 'e', 'english!', 'en_US', '-en'])
      expect(accepts(VideoBlockSchema, withLanguage(language))).toBe(false);
  });
});

describe('rich text', () => {
  it('counts characters across all runs', () => {
    expect(
      richTextLength([
        { runs: [{ text: 'ab' }, { text: 'c' }] },
        { runs: [] },
        { runs: [{ text: '\n' }] },
      ]),
    ).toBe(4);
  });

  it(`allows at most ${LIMITS.richText} characters in total`, () => {
    const half = 'x'.repeat(LIMITS.richText / 2);
    expect(accepts(RichTextSchema, [{ runs: [{ text: half }] }, { runs: [{ text: half }] }])).toBe(
      true,
    );
    expect(
      issuesOf(RichTextSchema, [
        { runs: [{ text: half }] },
        { runs: [{ text: half }, { text: '!' }] },
      ]),
    ).toEqual([
      {
        path: '',
        code: 'custom',
        message: 'Text can be at most 20,000 characters (this has 20,001).',
      },
    ]);
  });

  it('only knows the five marks', () => {
    expect(
      accepts(RichTextSchema, [
        { runs: [{ text: 'Hi', marks: ['bold', 'italic', 'underline', 'strike', 'code'] }] },
      ]),
    ).toBe(true);
    expect(accepts(RichTextSchema, [{ runs: [{ text: 'Hi', marks: ['blink'] }] }])).toBe(false);
  });
});

describe('limits', () => {
  const course = sampleCourse();
  const content = course.lessons[0] as F.ContentLesson;
  const cases: { name: string; ok: unknown; tooBig: unknown }[] = [
    {
      name: 'course title',
      ok: { ...course, title: 'x'.repeat(200) },
      tooBig: { ...course, title: 'x'.repeat(201) },
    },
    { name: 'empty course title', ok: { ...course, title: 'x' }, tooBig: { ...course, title: '' } },
    {
      name: 'summary',
      ok: { ...course, summary: 'x'.repeat(500) },
      tooBig: { ...course, summary: 'x'.repeat(501) },
    },
    {
      name: 'topics',
      ok: { ...course, topics: Array.from({ length: 10 }, (_, i) => `t${i}`) },
      tooBig: { ...course, topics: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    },
    {
      name: 'topic length',
      ok: { ...course, topics: ['x'.repeat(40)] },
      tooBig: { ...course, topics: ['x'.repeat(41)] },
    },
    {
      name: 'estimated minutes',
      ok: { ...course, estimatedMinutes: 600 },
      tooBig: { ...course, estimatedMinutes: 601 },
    },
    {
      name: 'whole estimated minutes',
      ok: { ...course, estimatedMinutes: 1 },
      tooBig: { ...course, estimatedMinutes: 1.5 },
    },
    {
      name: 'lessons',
      ok: {
        ...course,
        lessons: Array.from({ length: 100 }, (_, i) => ({ ...content, id: `l${i}` })),
      },
      tooBig: {
        ...course,
        lessons: Array.from({ length: 101 }, (_, i) => ({ ...content, id: `l${i}` })),
      },
    },
    {
      name: 'blocks',
      ok: {
        ...course,
        lessons: [
          {
            ...content,
            blocks: Array.from({ length: 300 }, (_, i) => ({
              ...blockSamples.divider,
              id: `b${i}`,
            })),
          },
        ],
      },
      tooBig: {
        ...course,
        lessons: [
          {
            ...content,
            blocks: Array.from({ length: 301 }, (_, i) => ({
              ...blockSamples.divider,
              id: `b${i}`,
            })),
          },
        ],
      },
    },
    {
      name: 'lesson minimum seconds',
      ok: { ...course, lessons: [{ ...content, minimumSeconds: 3600 }] },
      tooBig: { ...course, lessons: [{ ...content, minimumSeconds: 3601 }] },
    },
    {
      name: 'course minimum seconds',
      ok: withSettings({ minimumCourseSeconds: 36_000 }),
      tooBig: withSettings({ minimumCourseSeconds: 36_001 }),
    },
    {
      name: 'acknowledgement',
      ok: withSettings({ acknowledgement: { statement: 'x'.repeat(500) } }),
      tooBig: withSettings({ acknowledgement: { statement: 'x'.repeat(501) } }),
    },
    {
      name: 'certificate months',
      ok: withSettings({ certificate: { enabled: true, validForMonths: 120 } }),
      tooBig: withSettings({ certificate: { enabled: true, validForMonths: 121 } }),
    },
    {
      name: 'labels',
      ok: withSettings({ labels: { retry: 'x'.repeat(40) } }),
      tooBig: withSettings({ labels: { retry: 'x'.repeat(41) } }),
    },
    {
      name: 'review months',
      ok: withSettings({ reviewEveryMonths: 36 }),
      tooBig: withSettings({ reviewEveryMonths: 37 }),
    },
    {
      name: 'review months minimum',
      ok: withSettings({ reviewEveryMonths: 1 }),
      tooBig: withSettings({ reviewEveryMonths: 0 }),
    },
    {
      name: 'whole review months',
      ok: withSettings({ reviewEveryMonths: 6 }),
      tooBig: withSettings({ reviewEveryMonths: 6.5 }),
    },
    {
      name: 'pass mark',
      ok: withQuiz((q) => ({ ...q, settings: { ...q.settings, passMark: 100 } })),
      tooBig: withQuiz((q) => ({ ...q, settings: { ...q.settings, passMark: 100.5 } })),
    },
    {
      name: 'negative pass mark',
      ok: withQuiz((q) => ({ ...q, settings: { ...q.settings, passMark: 0 } })),
      tooBig: withQuiz((q) => ({ ...q, settings: { ...q.settings, passMark: -1 } })),
    },
    {
      name: 'max attempts',
      ok: withQuiz((q) => ({ ...q, settings: { ...q.settings, maxAttempts: 20 } })),
      tooBig: withQuiz((q) => ({ ...q, settings: { ...q.settings, maxAttempts: 21 } })),
    },
    {
      name: 'zero attempts',
      ok: withQuiz((q) => ({ ...q, settings: { ...q.settings, maxAttempts: 1 } })),
      tooBig: withQuiz((q) => ({ ...q, settings: { ...q.settings, maxAttempts: 0 } })),
    },
    {
      name: 'questions',
      ok: withQuiz((q) => ({
        ...q,
        questions: Array.from({ length: 200 }, (_, i) => ({
          ...questionSamples.true_false,
          id: `q${i}`,
        })),
      })),
      tooBig: withQuiz((q) => ({
        ...q,
        questions: Array.from({ length: 201 }, (_, i) => ({
          ...questionSamples.true_false,
          id: `q${i}`,
        })),
      })),
    },
    {
      name: 'bank draws',
      ok: withQuiz((q) => ({
        ...q,
        bankDraws: Array.from({ length: 10 }, (_, i) => ({ bankId: `bank-${i}`, count: 1 })),
      })),
      tooBig: withQuiz((q) => ({
        ...q,
        bankDraws: Array.from({ length: 11 }, (_, i) => ({ bankId: `bank-${i}`, count: 1 })),
      })),
    },
    {
      name: 'bank draw count',
      ok: withQuiz((q) => ({ ...q, bankDraws: [{ bankId: 'bank-1', count: 50 }] })),
      tooBig: withQuiz((q) => ({ ...q, bankDraws: [{ bankId: 'bank-1', count: 51 }] })),
    },
    {
      name: 'empty bank draw',
      ok: withQuiz((q) => ({ ...q, bankDraws: [] })),
      tooBig: withQuiz((q) => ({ ...q, bankDraws: [{ bankId: 'bank-1', count: 0 }] })),
    },
  ];
  for (const { name, ok, tooBig } of cases) {
    it(`checks the ${name} limit`, () => {
      expect(issuesOf(CourseSchema, ok)).toEqual([]);
      expect(accepts(CourseSchema, tooBig)).toBe(false);
    });
  }

  const blockCases: { name: string; ok: F.Block; tooBig: unknown }[] = [
    {
      name: 'heading level',
      ok: { ...blockSamples.heading, level: 3 },
      tooBig: { ...blockSamples.heading, level: 4 },
    },
    {
      name: 'statement',
      ok: { ...blockSamples.statement, text: 'x'.repeat(300) },
      tooBig: { ...blockSamples.statement, text: 'x'.repeat(301) },
    },
    {
      name: 'code',
      ok: { ...blockSamples.code, code: 'x'.repeat(20_000) },
      tooBig: { ...blockSamples.code, code: 'x'.repeat(20_001) },
    },
    {
      name: 'table rows',
      ok: { ...blockSamples.table, rows: Array.from({ length: 50 }, () => ['a']) },
      tooBig: { ...blockSamples.table, rows: Array.from({ length: 51 }, () => ['a']) },
    },
    {
      name: 'table columns',
      ok: { ...blockSamples.table, rows: [Array.from({ length: 10 }, () => 'a')] },
      tooBig: { ...blockSamples.table, rows: [Array.from({ length: 11 }, () => 'a')] },
    },
    {
      name: 'gallery',
      ok: { ...blockSamples.gallery, images: Array.from({ length: 20 }, () => image) },
      tooBig: { ...blockSamples.gallery, images: Array.from({ length: 21 }, () => image) },
    },
    {
      name: 'embed height',
      ok: { ...blockSamples.embed, height: 1200 },
      tooBig: { ...blockSamples.embed, height: 1201 },
    },
    {
      name: 'embed minimum height',
      ok: { ...blockSamples.embed, height: 100 },
      tooBig: { ...blockSamples.embed, height: 99 },
    },
    {
      name: 'marker position',
      ok: {
        ...blockSamples.labeled_graphic,
        markers: [{ id: 'm', x: 100, y: 0, title: 't', text: [] }],
      },
      tooBig: {
        ...blockSamples.labeled_graphic,
        markers: [{ id: 'm', x: 100.1, y: 0, title: 't', text: [] }],
      },
    },
    {
      name: 'sorting categories',
      ok: {
        ...blockSamples.sorting,
        categories: Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, title: 'c' })),
      },
      tooBig: {
        ...blockSamples.sorting,
        categories: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: 'c' })),
      },
    },
    {
      name: 'scenario choices',
      ok: {
        ...blockSamples.scenario,
        scenes: [
          {
            id: 's',
            text: 't',
            choices: Array.from({ length: 6 }, (_, i) => ({
              id: `c${i}`,
              text: 'c',
              points: 0,
              next: { kind: 'retry' },
            })),
          },
        ],
      },
      tooBig: {
        ...blockSamples.scenario,
        scenes: [
          {
            id: 's',
            text: 't',
            choices: Array.from({ length: 7 }, (_, i) => ({
              id: `c${i}`,
              text: 'c',
              points: 0,
              next: { kind: 'retry' },
            })),
          },
        ],
      },
    },
    {
      name: 'choice points',
      ok: {
        ...blockSamples.scenario,
        scenes: [
          {
            id: 's',
            text: 't',
            choices: [{ id: 'c', text: 'c', points: -10, next: { kind: 'retry' } }],
          },
        ],
      },
      tooBig: {
        ...blockSamples.scenario,
        scenes: [
          {
            id: 's',
            text: 't',
            choices: [{ id: 'c', text: 'c', points: -11, next: { kind: 'retry' } }],
          },
        ],
      },
    },
    {
      name: 'knowledge check question',
      ok: blockSamples.knowledge_check,
      tooBig: {
        ...blockSamples.knowledge_check,
        question: { ...questionSamples.hotspot, points: 0 },
      },
    },
  ];
  for (const { name, ok, tooBig } of blockCases) {
    it(`checks the ${name} limit`, () => {
      expect(issuesOf(BlockSchema, ok)).toEqual([]);
      expect(accepts(BlockSchema, tooBig)).toBe(false);
    });
  }

  const questionCases: { name: string; ok: F.Question; tooBig: unknown }[] = [
    {
      name: 'options',
      ok: {
        ...questionSamples.single_choice,
        options: Array.from({ length: 6 }, (_, i) => ({
          id: `o${i}`,
          text: 'o',
          correct: i === 0,
        })),
      },
      tooBig: {
        ...questionSamples.single_choice,
        options: Array.from({ length: 7 }, (_, i) => ({
          id: `o${i}`,
          text: 'o',
          correct: i === 0,
        })),
      },
    },
    {
      name: 'pairs',
      ok: {
        ...questionSamples.matching,
        pairs: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, prompt: 'p', match: 'm' })),
      },
      tooBig: {
        ...questionSamples.matching,
        pairs: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, prompt: 'p', match: 'm' })),
      },
    },
    {
      name: 'blank answers',
      ok: {
        ...questionSamples.fill_blank,
        parts: [{ kind: 'blank', id: 'b', answers: Array.from({ length: 10 }, (_, i) => `a${i}`) }],
      },
      tooBig: {
        ...questionSamples.fill_blank,
        parts: [{ kind: 'blank', id: 'b', answers: Array.from({ length: 11 }, (_, i) => `a${i}`) }],
      },
    },
    {
      name: 'ordering items',
      ok: {
        ...questionSamples.ordering,
        items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, text: 'i' })),
      },
      tooBig: {
        ...questionSamples.ordering,
        items: Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, text: 'i' })),
      },
    },
    {
      name: 'hotspot size',
      ok: {
        ...questionSamples.hotspot,
        spots: [
          {
            id: 's',
            shape: 'rect',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            correct: true,
            label: 'All',
          },
        ],
      },
      tooBig: {
        ...questionSamples.hotspot,
        spots: [
          {
            id: 's',
            shape: 'rect',
            x: 0,
            y: 0,
            width: 101,
            height: 100,
            correct: true,
            label: 'All',
          },
        ],
      },
    },
  ];
  for (const { name, ok, tooBig } of questionCases) {
    it(`checks the ${name} limit`, () => {
      expect(issuesOf(QuestionSchema, ok)).toEqual([]);
      expect(accepts(QuestionSchema, tooBig)).toBe(false);
    });
  }
});

describe('optional additions', () => {
  it('knows the cover layouts', () => {
    for (const coverLayout of ['banner', 'split', 'full'])
      expect(accepts(CourseSchema, { ...sampleCourse(), coverLayout })).toBe(true);
    expect(accepts(CourseSchema, { ...sampleCourse(), coverLayout: 'tile' })).toBe(false);
  });

  it('knows the quiz modes', () => {
    for (const mode of ['graded', 'survey'])
      expect(
        accepts(
          CourseSchema,
          withQuiz((q) => ({ ...q, settings: { ...q.settings, mode } })),
        ),
      ).toBe(true);
    expect(
      accepts(
        CourseSchema,
        withQuiz((q) => ({ ...q, settings: { ...q.settings, mode: 'exam' } })),
      ),
    ).toBe(false);
  });

  it('checks bank draw snapshots', () => {
    const snapshot = Array.from({ length: LIMITS.bankSnapshotQuestions + 1 }, (_, i) => ({
      ...questionSamples.true_false,
      id: `snap-${i}`,
    }));
    expect(
      accepts(
        CourseSchema,
        withQuiz((q) => ({
          ...q,
          bankDraws: [{ bankId: 'bank-1', count: 1, questions: snapshot.slice(1) }],
        })),
      ),
    ).toBe(true);
    expect(
      accepts(
        CourseSchema,
        withQuiz((q) => ({
          ...q,
          bankDraws: [{ bankId: 'bank-1', count: 1, questions: snapshot }],
        })),
      ),
    ).toBe(false);
    expect(
      accepts(
        CourseSchema,
        withQuiz((q) => ({ ...q, bankDraws: [{ bankId: 'constructor', count: 1 }] })),
      ),
    ).toBe(false);
  });
});

describe('learner answers', () => {
  const responses: F.QuestionResponse[] = [
    { type: 'single_choice', optionId: 'o1' },
    { type: 'multiple_choice', optionIds: ['o1', 'o2'] },
    { type: 'true_false', value: false },
    { type: 'matching', matches: { p1: 'p2', p2: 'p1' } },
    { type: 'drag_matching', matches: { p1: 'p1' } },
    { type: 'fill_blank', blanks: { hours: '24' } },
    { type: 'ordering', order: ['greet', 'listen', 'resolve'] },
    { type: 'hotspot', pick: { kind: 'point', x: 12.5, y: 40 } },
    { type: 'hotspot', pick: { kind: 'spot', spotId: 'mute' } },
  ];
  for (const response of responses) {
    it(`accepts a ${response.type} answer`, () => {
      expect(QuestionResponseSchema.parse(response)).toStrictEqual(response);
    });
  }

  it('rejects answers that break the limits', () => {
    expect(
      accepts(QuestionResponseSchema, { type: 'fill_blank', blanks: { hours: 'x'.repeat(501) } }),
    ).toBe(false);
    expect(
      accepts(QuestionResponseSchema, { type: 'hotspot', pick: { kind: 'point', x: 101, y: 0 } }),
    ).toBe(false);
    const nineMatches = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, `p${i}`]));
    expect(
      issuesOf(QuestionResponseSchema, { type: 'matching', matches: nineMatches })[0]?.message,
    ).toBe('At most 8 matches.');
    expect(accepts(QuestionResponseSchema, { type: 'ordering', order: ['a'], extra: true })).toBe(
      false,
    );
  });

  it('rejects reserved ids as answer keys and never lets __proto__ through', () => {
    expect(
      accepts(QuestionResponseSchema, { type: 'fill_blank', blanks: { constructor: '24' } }),
    ).toBe(false);
    const parsed = QuestionResponseSchema.parse(
      JSON.parse('{"type":"matching","matches":{"__proto__":"p1","p2":"p2"}}'),
    );
    if (parsed.type !== 'matching' && parsed.type !== 'drag_matching')
      throw new Error('expected a matching answer');
    expect(Object.getPrototypeOf(parsed.matches)).toBe(Object.prototype);
    expect(Object.keys(parsed.matches)).toEqual(['p2']);
  });
});

describe('learning paths and files', () => {
  const path: F.LearningPath = {
    formatVersion: 1,
    id: 'path-onboarding',
    title: 'New starter path',
    description: 'Everything for your first week.',
    courseIds: ['course-phone-basics', 'course-privacy'],
    order: 'sequential',
  };

  it('accepts a learning path', () => {
    expect(LearningPathSchema.parse(path)).toStrictEqual(path);
  });

  it('rejects a course listed twice in a path', () => {
    expect(issuesOf(LearningPathSchema, { ...path, courseIds: ['a', 'b', 'a'] })).toEqual([
      { path: 'courseIds.2', code: 'custom', message: 'Course "a" is already in this path.' },
    ]);
  });

  it('allows at most 30 courses in a path', () => {
    const ids = Array.from({ length: 31 }, (_, i) => `course-${i}`);
    expect(accepts(LearningPathSchema, { ...path, courseIds: ids.slice(1) })).toBe(true);
    expect(accepts(LearningPathSchema, { ...path, courseIds: ids })).toBe(false);
  });

  it('accepts the import and export envelope', () => {
    const file: F.CourseFile = {
      format: 'carehub.learning.course',
      exportedAt: '2026-10-27T15:00:00.000Z',
      course: sampleCourse(),
    };
    expect(CourseFileSchema.parse(file)).toStrictEqual(file);
    expect(accepts(CourseFileSchema, { ...file, exportedAt: '2026-10-27T17:00:00+02:00' })).toBe(
      true,
    );
    expect(accepts(CourseFileSchema, { ...file, exportedAt: '2026-10-27' })).toBe(false);
    expect(accepts(CourseFileSchema, { ...file, format: 'carehub.learning.path' })).toBe(false);
  });

  it('checks calendar days', () => {
    for (const day of ['2026-10-27', '2028-02-29', '2000-02-29'])
      expect(accepts(IsoDateSchema, day)).toBe(true);
    for (const day of [
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-10-27T00:00:00Z',
      '27/10/2026',
    ])
      expect(accepts(IsoDateSchema, day)).toBe(false);
  });
});
