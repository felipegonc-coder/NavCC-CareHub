import { describe, expect, it } from 'vitest';
import {
  sampleCertificationCourse,
  sampleCourses,
  sampleScenarioLabCourse,
  sampleShowcaseCourse,
  sampleStandardCourse,
} from '../fixtures/index';
import type { Block, ContentLesson, Course, Question, QuizLesson, ScenarioBlock } from './index';
import { checkPublishable, richText } from './index';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const messages = (course: Course) => checkPublishable(course).map((problem) => problem.message);

const contentLesson = (course: Course, index: number): ContentLesson => {
  const lesson = course.lessons[index];
  if (lesson?.kind !== 'content') throw new Error(`lesson ${index} is not a content lesson`);
  return lesson;
};
const quizLesson = (course: Course, index: number): QuizLesson => {
  const lesson = course.lessons[index];
  if (lesson?.kind !== 'quiz') throw new Error(`lesson ${index} is not a quiz lesson`);
  return lesson;
};

/** The standard sample course with one content lesson holding just `blocks`. */
const withBlocks = (...blocks: Block[]): Course => {
  const course = copy(sampleStandardCourse);
  return {
    ...course,
    lessons: [{ ...contentLesson(course, 0), blocks }, ...course.lessons.slice(1)],
  };
};
/** The standard sample course with its final quiz (lesson 4) changed. */
const withQuiz = (change: (quiz: QuizLesson) => QuizLesson): Course => {
  const course = copy(sampleStandardCourse);
  return {
    ...course,
    lessons: course.lessons.map((lesson, i) => (i === 3 ? change(quizLesson(course, 3)) : lesson)),
  };
};
const withQuestion = (question: Question): Course =>
  withQuiz((quiz) => ({ ...quiz, questions: [question] }));
const scenarioOf = (course: Course): ScenarioBlock => {
  const block = contentLesson(course, 0).blocks.find(
    (b): b is ScenarioBlock => b.type === 'scenario',
  );
  if (!block) throw new Error('no scenario block');
  return block;
};
const withScenario = (change: (scenario: ScenarioBlock) => ScenarioBlock): Course => {
  const course = copy(sampleScenarioLabCourse);
  const lesson = contentLesson(course, 0);
  const blocks = lesson.blocks.map((block) => (block.type === 'scenario' ? change(block) : block));
  return { ...course, lessons: [{ ...lesson, blocks }] };
};

const choice = (id: string, correct: boolean) => ({ id, text: `Option ${id}`, correct });
const single: Question = {
  id: 'q-single',
  type: 'single_choice',
  prompt: richText('Pick one.'),
  points: 1,
  options: [choice('a', true), choice('b', false)],
};

describe('checkPublishable', () => {
  it('passes every sample course', () => {
    for (const course of sampleCourses) expect(checkPublishable(course)).toEqual([]);
  });

  it("writes problems like the format doc's example, with ids and a path", () => {
    const course = copy(sampleStandardCourse);
    const quiz = quizLesson(course, 3);
    const broken: Course = {
      ...course,
      lessons: [
        contentLesson(course, 0),
        {
          ...quiz,
          title: 'Escalations',
          questions: [
            single,
            { ...single, id: 'q2' },
            { ...single, id: 'q3', options: [choice('a', false), choice('b', false)] },
          ],
        },
      ],
    };
    expect(checkPublishable(broken)).toStrictEqual([
      {
        path: 'lessons[1].questions[2].options',
        lessonId: 'calls-quiz',
        questionId: 'q3',
        message: 'Lesson 2 "Escalations": question 3 has no correct answer.',
      },
    ]);
  });

  describe('course', () => {
    it('needs a title, a lesson and a way to be completed', () => {
      const course = copy(sampleStandardCourse);
      const empty: Course = {
        ...course,
        title: '  ',
        lessons: [],
        settings: {
          ...course.settings,
          completion: {
            requireAllLessons: false,
            requireQuizPass: false,
            requireAcknowledgement: false,
          },
        },
      };
      expect(checkPublishable(empty)).toStrictEqual([
        { path: 'title', message: 'The course needs a title.' },
        { path: 'lessons', message: 'The course needs at least one lesson.' },
        {
          path: 'settings.completion',
          message:
            'The course needs at least one way to be completed (all lessons, a quiz pass or an acknowledgement).',
        },
      ]);
    });

    it('needs a graded quiz lesson when completion asks for a quiz pass', () => {
      const noQuiz = {
        ...copy(sampleStandardCourse),
        lessons: copy(sampleStandardCourse).lessons.slice(0, 2),
      };
      expect(messages(noQuiz)).toEqual([
        'The course asks for a quiz pass but has no graded quiz lesson.',
      ]);
      const surveyOnly = withQuiz((quiz) => ({
        ...quiz,
        settings: { ...quiz.settings, mode: 'survey' },
        questions: [single],
      }));
      expect(messages(surveyOnly)).toEqual([
        'The course asks for a quiz pass but has no graded quiz lesson.',
      ]);
    });

    it('needs the acknowledgement statement when completion asks for one', () => {
      const course = copy(sampleStandardCourse);
      const completion = { ...course.settings.completion, requireAcknowledgement: true };
      expect(messages({ ...course, settings: { ...course.settings, completion } })).toEqual([
        'The course asks for an acknowledgement but has no statement to acknowledge.',
      ]);
      expect(
        messages({
          ...course,
          settings: { ...course.settings, completion, acknowledgement: { statement: ' ' } },
        }),
      ).toHaveLength(1);
      expect(
        messages({
          ...course,
          settings: { ...course.settings, completion, acknowledgement: { statement: 'I agree.' } },
        }),
      ).toEqual([]);
    });

    it('needs alt text unless a picture is decorative', () => {
      const course = copy(sampleStandardCourse);
      const cover = { media: { kind: 'file' as const, fileId: 'sample-cover-1' }, alt: '' };
      expect(checkPublishable({ ...course, cover })).toStrictEqual([
        {
          path: 'cover.alt',
          message: 'The course needs alt text for the cover picture, or mark it as decorative.',
        },
      ]);
      expect(checkPublishable({ ...course, cover: { ...cover, decorative: true } })).toEqual([]);
    });
  });

  describe('lessons', () => {
    it('needs unique ids, titles and content', () => {
      const course = copy(sampleStandardCourse);
      const first = contentLesson(course, 0);
      const broken: Course = {
        ...course,
        lessons: [
          { ...first, title: ' ' },
          { ...contentLesson(course, 1), id: first.id, blocks: [] },
          quizLesson(course, 3),
        ],
      };
      expect(checkPublishable(broken)).toStrictEqual([
        { path: 'lessons[0].title', lessonId: 'calls-before', message: 'Lesson 1 needs a title.' },
        {
          path: 'lessons[1].id',
          lessonId: 'calls-before',
          message:
            'Lesson 2 "During the call" has the same id as an earlier lesson ("calls-before").',
        },
        {
          path: 'lessons[1].blocks',
          lessonId: 'calls-before',
          message: 'Lesson 2 "During the call" has no blocks.',
        },
      ]);
    });

    it('needs block and question ids to be unique across the course', () => {
      const course = copy(sampleStandardCourse);
      const second = contentLesson(course, 1);
      const quiz = quizLesson(course, 3);
      const [firstQuestion, ...rest] = quiz.questions as [Question, ...Question[]];
      const broken: Course = {
        ...course,
        lessons: [
          contentLesson(course, 0),
          {
            ...second,
            blocks: second.blocks.map((block, i) =>
              i === 0 ? { ...block, id: 'calls-before-heading' } : block,
            ),
          },
          { ...quiz, questions: [{ ...firstQuestion, id: 'calls-check-greeting' }, ...rest] },
        ],
      };
      expect(checkPublishable(broken)).toStrictEqual([
        {
          path: 'lessons[1].blocks[0].id',
          lessonId: 'calls-during',
          blockId: 'calls-before-heading',
          message:
            'Lesson 2 "During the call": block 1 (paragraph) has the same id as an earlier block ("calls-before-heading").',
        },
        {
          path: 'lessons[2].questions[0].id',
          lessonId: 'calls-quiz',
          questionId: 'calls-check-greeting',
          message:
            'Lesson 3 "Final quiz": question 1 has the same id as an earlier question ("calls-check-greeting").',
        },
      ]);
    });

    it('checks links to lessons and blocks', () => {
      const course = copy(sampleStandardCourse);
      const link = (lessonId: string, blockId?: string) =>
        ({
          id: 'b-link',
          type: 'paragraph',
          text: richText([
            {
              text: 'See',
              link: blockId ? { kind: 'lesson', lessonId, blockId } : { kind: 'lesson', lessonId },
            },
          ]),
        }) satisfies Block;
      expect(messages(withBlocks(link('calls-quiz')))).toEqual([]);
      expect(messages(withBlocks(link('calls-during', 'calls-during-faq')))).toEqual([]);
      expect(checkPublishable(withBlocks(link('nowhere')))).toStrictEqual([
        {
          path: 'lessons[0].blocks[0].text[0].runs[0].link',
          lessonId: 'calls-before',
          blockId: 'b-link',
          message:
            'Lesson 1 "Before the call": block 1 (paragraph) links to a lesson that doesn\'t exist ("nowhere").',
        },
      ]);
      expect(messages(withBlocks(link('calls-quiz', 'calls-during-faq')))).toEqual([
        'Lesson 1 "Before the call": block 1 (paragraph) links to a block that isn\'t in that lesson ("calls-during-faq").',
      ]);
      const button: Block = {
        id: 'b-button',
        type: 'button',
        label: 'Go',
        target: { kind: 'lesson', lessonId: 'gone' },
      };
      expect(messages(withBlocks(button))).toEqual([
        'Lesson 1 "Before the call": block 1 (button) links to a lesson that doesn\'t exist ("gone").',
      ]);
      const description = richText([
        { text: 'Start here', link: { kind: 'lesson', lessonId: 'gone' } },
      ]);
      expect(checkPublishable({ ...course, description })[0]?.path).toBe(
        'description[0].runs[0].link',
      );
    });
  });

  describe('blocks', () => {
    const rt = richText('Text');
    const cases: { block: Block; message: string; path: string }[] = [
      {
        block: { id: 'b', type: 'heading', level: 1, text: ' ' },
        message: 'needs text.',
        path: '.text',
      },
      {
        block: { id: 'b', type: 'paragraph', text: richText('', ' ') },
        message: 'needs text.',
        path: '.text',
      },
      {
        block: { id: 'b', type: 'list', style: 'bulleted', items: [] },
        message: 'needs at least 1 item.',
        path: '.items',
      },
      {
        block: { id: 'b', type: 'list', style: 'bulleted', items: [{ id: 'i', text: [] }] },
        message: 'item 1 needs text.',
        path: '.items[0].text',
      },
      {
        block: {
          id: 'b',
          type: 'list',
          style: 'bulleted',
          items: [
            { id: 'i', text: rt },
            { id: 'i', text: rt },
          ],
        },
        message: 'has two items with the id "i".',
        path: '.items[1].id',
      },
      {
        block: { id: 'b', type: 'callout', tone: 'note', text: [] },
        message: 'needs text.',
        path: '.text',
      },
      { block: { id: 'b', type: 'statement', text: '' }, message: 'needs text.', path: '.text' },
      { block: { id: 'b', type: 'quote', text: '' }, message: 'needs text.', path: '.text' },
      {
        block: { id: 'b', type: 'quote_carousel', quotes: [{ id: 'q', text: 'Hi' }] },
        message: 'needs at least 2 quotes.',
        path: '.quotes',
      },
      {
        block: { id: 'b', type: 'two_column', left: [], right: [] },
        message: 'needs text in at least one column.',
        path: '.left',
      },
      { block: { id: 'b', type: 'code', code: '' }, message: 'needs code.', path: '.code' },
      {
        block: { id: 'b', type: 'table', headerRow: false, rows: [['a', 'b'], ['c']] },
        message: 'needs the same number of cells in every row.',
        path: '.rows',
      },
      {
        block: {
          id: 'b',
          type: 'image',
          image: { media: { kind: 'file', fileId: 'f' }, alt: ' ' },
          size: 'small',
        },
        message: 'needs alt text for the picture, or mark it as decorative.',
        path: '.image.alt',
      },
      {
        block: {
          id: 'b',
          type: 'gallery',
          layout: 'grid',
          images: [{ media: { kind: 'file', fileId: 'f' }, alt: 'A' }],
        },
        message: 'needs at least 2 pictures.',
        path: '.images',
      },
      {
        block: { id: 'b', type: 'video', media: { kind: 'file', fileId: 'f' }, title: '' },
        message: 'needs a title for screen-reader users.',
        path: '.title',
      },
      {
        block: { id: 'b', type: 'audio', media: { kind: 'file', fileId: 'f' }, title: '' },
        message: 'needs a title for screen-reader users.',
        path: '.title',
      },
      {
        block: { id: 'b', type: 'embed', url: 'https://forms.example.org/x', title: '' },
        message: 'needs a title for screen-reader users.',
        path: '.title',
      },
      {
        block: { id: 'b', type: 'file', fileId: 'f', name: '' },
        message: 'needs a file name.',
        path: '.name',
      },
      {
        block: { id: 'b', type: 'accordion', items: [{ id: 'a', title: 'Q', body: [] }] },
        message: 'item 1 needs a title and text.',
        path: '.items[0]',
      },
      {
        block: { id: 'b', type: 'tabs', tabs: [{ id: 't', title: 'T', body: rt }] },
        message: 'needs at least 2 tabs.',
        path: '.tabs',
      },
      {
        block: { id: 'b', type: 'timeline', items: [{ id: 't', label: '1', title: 'T' }] },
        message: 'needs at least 2 items.',
        path: '.items',
      },
      {
        block: { id: 'b', type: 'process', steps: [{ id: 's', title: 'S', body: rt }] },
        message: 'needs at least 2 steps.',
        path: '.steps',
      },
      {
        block: { id: 'b', type: 'flashcards', cards: [] },
        message: 'needs at least 1 card.',
        path: '.cards',
      },
      {
        block: { id: 'b', type: 'flashcards', cards: [{ id: 'c', front: '', back: 'B' }] },
        message: 'card 1 needs text or a picture on the front.',
        path: '.cards[0].front',
      },
      {
        block: {
          id: 'b',
          type: 'sorting',
          categories: [
            { id: 'c1', title: 'One' },
            { id: 'c2', title: 'Two' },
          ],
          items: [
            { id: 'i1', text: 'A', categoryId: 'c1' },
            { id: 'i2', text: 'B', categoryId: 'c3' },
          ],
        },
        message: 'item 2 belongs to a category that doesn\'t exist ("c3").',
        path: '.items[1].categoryId',
      },
      {
        block: {
          id: 'b',
          type: 'labeled_graphic',
          image: { media: { kind: 'file', fileId: 'f' }, alt: 'A' },
          markers: [{ id: 'm', x: 1, y: 1, title: '', text: rt }],
        },
        message: 'marker 1 needs a title.',
        path: '.markers[0].title',
      },
      {
        block: { id: 'b', type: 'button', label: ' ', target: { kind: 'page', pageId: 'p' } },
        message: 'needs a label.',
        path: '.label',
      },
    ];
    for (const { block, message, path } of cases) {
      it(`checks ${block.type} blocks: ${message}`, () => {
        const problems = checkPublishable(withBlocks(block));
        expect(problems.map((p) => p.message)).toContain(
          `Lesson 1 "Before the call": block 1 (${block.type.replaceAll('_', ' ')}) ${message}`,
        );
        expect(problems.map((p) => p.path)).toContain(`lessons[0].blocks[0]${path}`);
      });
    }

    it('accepts decorative pictures without alt text and empty divider or continue blocks', () => {
      const decorative: Block = {
        id: 'b',
        type: 'image',
        image: { media: { kind: 'file', fileId: 'f' }, alt: '', decorative: true },
        size: 'full',
      };
      expect(
        messages(
          withBlocks(
            decorative,
            { id: 'd', type: 'divider', style: 'spacer' },
            { id: 'c', type: 'continue', requires: 'click' },
          ),
        ),
      ).toEqual([]);
    });

    it('checks the question inside a knowledge check', () => {
      const check: Block = {
        id: 'kc',
        type: 'knowledge_check',
        allowRetry: true,
        question: { ...single, options: [choice('a', false), choice('b', false)] },
      };
      expect(checkPublishable(withBlocks(check))).toStrictEqual([
        {
          path: 'lessons[0].blocks[0].question.options',
          lessonId: 'calls-before',
          blockId: 'kc',
          questionId: 'q-single',
          message: 'Lesson 1 "Before the call": block 1 (knowledge check) has no correct answer.',
        },
      ]);
    });
  });

  describe('scenarios', () => {
    const prefix = 'Lesson 1 "The late reply": block 2 (scenario)';

    it('checks the start scene, scene links and speakers', () => {
      const broken = withScenario((scenario) => ({
        ...scenario,
        title: '',
        startSceneId: 'missing',
        scenes: scenario.scenes.map((scene, i) =>
          i === 0
            ? {
                ...scene,
                speakerId: 'nobody',
                choices: scene.choices.map((c, j) =>
                  j === 0 ? { ...c, next: { kind: 'scene', sceneId: 'nowhere' } } : c,
                ),
              }
            : scene,
        ),
      }));
      expect(messages(broken)).toEqual([
        `${prefix} needs a title.`,
        `${prefix} starts at a scene that doesn't exist ("missing").`,
        `${prefix} scene "opening" has a speaker who isn't one of the characters.`,
        `${prefix} scene "opening", choice 1 leads to a scene that doesn't exist ("nowhere").`,
      ]);
    });

    it("doesn't let a choice that starts again give points", () => {
      const scenario = scenarioOf(copy(sampleScenarioLabCourse));
      const retryAt = scenario.scenes
        .flatMap((scene, s) => scene.choices.map((choice, c) => ({ s, c, kind: choice.next.kind })))
        .find((x) => x.kind === 'retry');
      if (!retryAt) throw new Error('the sample scenario should have a retry choice');
      const withPoints = (points: number) =>
        withScenario((s) => ({
          ...s,
          scenes: s.scenes.map((scene, i) =>
            i === retryAt.s
              ? {
                  ...scene,
                  choices: scene.choices.map((choice, j) =>
                    j === retryAt.c ? { ...choice, points } : choice,
                  ),
                }
              : scene,
          ),
        }));
      const scene = scenario.scenes[retryAt.s];
      expect(checkPublishable(withPoints(5))).toEqual([
        {
          path: `lessons[0].blocks[1].scenes[${retryAt.s}].choices[${retryAt.c}].points`,
          lessonId: sampleScenarioLabCourse.lessons[0]?.id,
          blockId: scenario.id,
          message: `${prefix} scene "${scene?.id}", choice ${retryAt.c + 1}: a choice that sends the learner to try again can't give points.`,
        },
      ]);
      expect(messages(withPoints(0))).toEqual([]);
      expect(messages(withPoints(-3))).toEqual([]);
    });

    it('needs an ending on scenes without choices', () => {
      const broken = withScenario((scenario) => ({
        ...scenario,
        scenes: scenario.scenes.map((scene) => ({ ...scene, ending: undefined })),
      }));
      expect(messages(broken)).toEqual([
        `${prefix} scene "calmer" has no choices, so it needs an ending.`,
      ]);
    });

    it("rejects loops and scenes that can't reach an ending", () => {
      const scenario = scenarioOf(copy(sampleScenarioLabCourse));
      const [opening, angrier] = scenario.scenes as [
        ScenarioBlock['scenes'][number],
        ScenarioBlock['scenes'][number],
      ];
      const loop = withScenario((s) => ({
        ...s,
        scenes: [
          {
            ...opening,
            choices: [
              { id: 'on', text: 'On', points: 0, next: { kind: 'scene', sceneId: 'angrier' } },
            ],
          },
          {
            ...angrier,
            choices: [
              { id: 'back', text: 'Back', points: 0, next: { kind: 'scene', sceneId: 'opening' } },
            ],
          },
          ...s.scenes.slice(2),
        ],
      }));
      expect(messages(loop)).toEqual([
        `${prefix} has scenes that lead in a circle back to scene "opening"; use "retry" to start again instead.`,
        `${prefix} scene "opening" can't reach an ending.`,
        `${prefix} scene "angrier" can't reach an ending.`,
      ]);
      const stuck = withScenario((s) => ({
        ...s,
        scenes: s.scenes.map((scene) =>
          scene.id === 'angrier'
            ? {
                ...scene,
                choices: [{ id: 'again', text: 'Again', points: 0, next: { kind: 'retry' } }],
              }
            : scene,
        ),
      }));
      expect(messages(stuck)).toEqual([`${prefix} scene "angrier" can't reach an ending.`]);
    });
  });

  describe('questions', () => {
    const prefix = 'Lesson 4 "Final quiz": question 1';
    const cases: { question: Question; message: string }[] = [
      { question: { ...single, prompt: [] }, message: 'needs question text.' },
      {
        question: { ...single, options: [choice('a', true), choice('b', true)] },
        message: 'has more than one correct answer; use multiple choice instead.',
      },
      {
        question: { ...single, options: [choice('a', true)] },
        message: 'needs at least 2 options.',
      },
      {
        question: { ...single, options: [choice('a', true), { ...choice('b', false), text: ' ' }] },
        message: 'option 2 needs text.',
      },
      {
        question: { ...single, options: [choice('a', true), choice('a', false)] },
        message: 'has two options with the id "a".',
      },
      {
        question: {
          ...single,
          type: 'multiple_choice',
          options: [choice('a', false), choice('b', false)],
        },
        message: 'has no correct answer.',
      },
      {
        question: { ...single, image: { media: { kind: 'file', fileId: 'f' }, alt: '' } },
        message: 'needs alt text for the picture, or mark it as decorative.',
      },
      {
        question: {
          id: 'q',
          type: 'matching',
          prompt: richText('Match'),
          points: 1,
          pairs: [{ id: 'p', prompt: 'A', match: 'B' }],
        },
        message: 'needs at least 2 pairs.',
      },
      {
        question: {
          id: 'q',
          type: 'drag_matching',
          prompt: richText('Match'),
          points: 1,
          pairs: [
            { id: 'p1', prompt: 'A', match: '' },
            { id: 'p2', prompt: 'C', match: 'D' },
          ],
        },
        message: 'pair 1 needs both sides.',
      },
      {
        question: {
          id: 'q',
          type: 'fill_blank',
          prompt: richText('Fill'),
          points: 1,
          parts: [{ kind: 'text', text: 'No blanks' }],
        },
        message: 'needs at least one blank.',
      },
      {
        question: {
          id: 'q',
          type: 'fill_blank',
          prompt: richText('Fill'),
          points: 1,
          parts: [
            { kind: 'text', text: 'A ' },
            { kind: 'blank', id: 'b', answers: [' '] },
          ],
        },
        message: 'blank 1 needs at least one accepted answer.',
      },
      {
        question: {
          id: 'q',
          type: 'ordering',
          prompt: richText('Order'),
          points: 1,
          items: [{ id: 'i', text: 'Only' }],
        },
        message: 'needs at least 2 items to put in order.',
      },
      {
        question: {
          id: 'q',
          type: 'hotspot',
          prompt: richText('Click'),
          points: 1,
          image: { media: { kind: 'file', fileId: 'f' }, alt: 'Screen' },
          spots: [
            {
              id: 's',
              shape: 'rect',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              correct: false,
              label: '',
            },
          ],
        },
        message: 'has no correct area.',
      },
    ];
    for (const { question, message } of cases) {
      it(`checks ${question.type} questions: ${message}`, () => {
        expect(messages(withQuestion(question))).toContain(`${prefix} ${message}`);
      });
    }

    it('needs hotspot areas to have labels', () => {
      const hotspot = sampleShowcaseCourse.lessons
        .flatMap((l) => (l.kind === 'quiz' ? l.questions : []))
        .find((q) => q.type === 'hotspot');
      if (!hotspot || hotspot.type !== 'hotspot')
        throw new Error('no hotspot question in the showcase');
      const unlabeled = {
        ...hotspot,
        spots: hotspot.spots.map((spot) => ({ ...spot, label: '' })),
      };
      expect(messages(withQuestion(unlabeled))).toEqual([
        `${prefix} area 1 needs a label for keyboard and screen-reader users.`,
        `${prefix} area 2 needs a label for keyboard and screen-reader users.`,
      ]);
    });
  });

  describe('quiz lessons', () => {
    it('needs at least one question or bank draw', () => {
      expect(messages(withQuiz((quiz) => ({ ...quiz, questions: [] })))).toEqual([
        'Lesson 4 "Final quiz" has no questions.',
      ]);
      expect(
        messages(
          withQuiz((quiz) => ({
            ...quiz,
            questions: [],
            bankDraws: [{ bankId: 'bank-1', count: 3 }],
          })),
        ),
      ).toEqual([]);
    });

    it("can't draw more of its own questions than it has", () => {
      expect(
        checkPublishable(
          withQuiz((quiz) => ({ ...quiz, settings: { ...quiz.settings, poolSize: 6 } })),
        ),
      ).toStrictEqual([
        {
          path: 'lessons[3].settings.poolSize',
          lessonId: 'calls-quiz',
          message: 'Lesson 4 "Final quiz" draws 6 questions per attempt but has only 5.',
        },
      ]);
      expect(
        messages(withQuiz((quiz) => ({ ...quiz, settings: { ...quiz.settings, poolSize: 5 } }))),
      ).toEqual([]);
    });

    it("checks bank draws once the bank's questions are copied in", () => {
      const course = copy(sampleCertificationCourse);
      const exam = quizLesson(course, 1);
      const [draw] = exam.bankDraws ?? [];
      if (!draw?.questions) throw new Error('the certification sample has a bank draw');
      const withDraws = (bankDraws: QuizLesson['bankDraws']): Course => ({
        ...course,
        lessons: course.lessons.map((lesson, i) => (i === 1 ? { ...exam, bankDraws } : lesson)),
      });
      const prefix = 'Lesson 2 "Certification exam"';
      expect(messages(withDraws([{ ...draw, count: 4 }]))).toEqual([
        `${prefix} draws 4 questions from bank "bank-escalations", which has only 3.`,
      ]);
      expect(messages(withDraws([{ bankId: draw.bankId, count: 40 }]))).toEqual([]);
      expect(messages(withDraws([draw, { bankId: draw.bankId, count: 1 }]))).toEqual([
        `${prefix} draws from bank "bank-escalations" more than once; use one draw with a bigger count.`,
      ]);
      const clash = {
        ...draw,
        questions: draw.questions.map((q, i) => (i === 0 ? { ...q, id: 'esc-q-urgent' } : q)),
      };
      expect(checkPublishable(withDraws([clash]))).toStrictEqual([
        {
          path: 'lessons[1].bankDraws[0].questions[0].id',
          lessonId: 'esc-exam',
          questionId: 'esc-q-urgent',
          message: `${prefix}: question 1 from bank "bank-escalations" has the same id as another question in this lesson ("esc-q-urgent").`,
        },
      ]);
      const reusedElsewhere = {
        ...draw,
        questions: draw.questions.map((q, i) => (i === 0 ? { ...q, id: 'esc-survey-useful' } : q)),
      };
      expect(messages(withDraws([reusedElsewhere]))).toEqual([]);
      const incomplete = {
        ...draw,
        questions: draw.questions.map((q, i) => (i === 0 ? { ...q, prompt: [] } : q)),
      };
      expect(messages(withDraws([incomplete]))).toEqual([
        `${prefix}: question 1 from bank "bank-escalations" needs question text.`,
      ]);
    });

    it('allows only choice questions without right answers in survey lessons', () => {
      const course = copy(sampleCertificationCourse);
      const survey = quizLesson(course, 2);
      const trueFalse: Question = {
        id: 'esc-survey-tf',
        type: 'true_false',
        prompt: richText('Was it fun?'),
        points: 1,
        answer: true,
      };
      const broken: Course = {
        ...course,
        lessons: course.lessons.map((lesson, i) =>
          i === 2 ? { ...survey, questions: [...survey.questions, trueFalse] } : lesson,
        ),
      };
      expect(messages(broken)).toEqual([
        'Lesson 3 "Tell us what you think": question 3 is a true false question, but survey lessons only allow single and multiple choice.',
      ]);
      // The sample survey marks no option correct, and that's fine.
      expect(
        survey.questions
          .flatMap((q) =>
            q.type === 'single_choice' || q.type === 'multiple_choice' ? q.options : [],
          )
          .some((o) => o.correct),
      ).toBe(false);
      expect(messages(course)).toEqual([]);
    });
  });
});
