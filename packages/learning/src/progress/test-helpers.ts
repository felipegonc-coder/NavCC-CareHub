// Test-only builders for fictional courses and event streams (not exported from the package).
import { CourseSchema, type Course, type CourseSettings, type QuizLesson } from '../format/index';
import { planAttempt, type AttemptPlan } from '../quiz/index';
import type { NewProgressEvent, ProgressEvent } from './schema';

const rich = (text: string) => [{ runs: [{ text }] }];

export const singleChoice = (id: string) => ({
  id,
  type: 'single_choice',
  prompt: rich('Which reply keeps the customer informed?'),
  options: [
    { id: 'right', text: 'Explain the next step', correct: true },
    { id: 'wrong', text: 'Say nothing', correct: false },
  ],
});

export const blocks = {
  paragraph: (id: string) => ({ id, type: 'paragraph', text: rich('Fictional training text.') }),
  continue: (id: string, requires: 'click' | 'complete_above' = 'click') => ({
    id,
    type: 'continue',
    requires,
  }),
  check: (id: string, allowRetry = true) => ({
    id,
    type: 'knowledge_check',
    allowRetry,
    question: singleChoice(`${id}-q`),
  }),
  process: (id: string) => ({
    id,
    type: 'process',
    steps: [
      { id: `${id}-1`, title: 'Greet', body: rich('Say hello.') },
      { id: `${id}-2`, title: 'Listen', body: rich('Let them explain.') },
    ],
  }),
  button: (id: string, lessonId: string) => ({
    id,
    type: 'button',
    label: 'Go there',
    target: { kind: 'lesson', lessonId },
  }),
  /** good → great ending (+5), bad → poor ending (-2), again → retry (stays), jump → `jumpTo` (+1). */
  scenario: (id: string, jumpTo = 'l1') => ({
    id,
    type: 'scenario',
    title: 'A late delivery call',
    characters: [{ id: 'sam', name: 'Sam (fictional customer)' }],
    startSceneId: 'start',
    passScore: 5,
    scenes: [
      {
        id: 'start',
        speakerId: 'sam',
        text: 'My parcel is late again.',
        choices: [
          {
            id: 'good',
            text: 'Check the order',
            points: 5,
            next: { kind: 'scene', sceneId: 'great' },
          },
          {
            id: 'bad',
            text: 'Blame the courier',
            points: -2,
            next: { kind: 'scene', sceneId: 'poor' },
          },
          { id: 'again', text: 'Think again', points: 0, next: { kind: 'retry' } },
          {
            id: 'jump',
            text: 'Review the basics',
            points: 1,
            next: { kind: 'lesson', lessonId: jumpTo },
          },
        ],
      },
      { id: 'great', text: 'Thanks!', choices: [], ending: { outcome: 'great', title: 'Sorted' } },
      { id: 'poor', text: 'Hmm.', choices: [], ending: { outcome: 'poor', title: 'Unhappy' } },
    ],
  }),
};

export const content = (
  id: string,
  lessonBlocks: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'content',
  title: `Lesson ${id}`,
  blocks: lessonBlocks,
  ...extra,
});

export const quiz = (id: string, settings: Record<string, unknown> = {}, questions = 5) => ({
  id,
  kind: 'quiz',
  title: `Quiz ${id}`,
  settings: {
    passMark: 80,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
    ...settings,
  },
  questions: Array.from({ length: questions }, (_, index) => singleChoice(`${id}-q${index + 1}`)),
});

export function makeCourse(input: {
  lessons: unknown[];
  lessonOrder?: 'free' | 'sequential';
  completion?: Partial<CourseSettings['completion']>;
  minimumCourseSeconds?: number;
  acknowledgement?: string;
  /** Replaces every setting above (e.g. presetFor(type).settings). */
  settings?: CourseSettings;
}): Course {
  const settings = input.settings ?? {
    lessonOrder: input.lessonOrder ?? 'free',
    completion: {
      requireAllLessons: true,
      requireQuizPass: false,
      requireAcknowledgement: false,
      ...input.completion,
    },
    ...(input.minimumCourseSeconds !== undefined && {
      minimumCourseSeconds: input.minimumCourseSeconds,
    }),
    ...(input.acknowledgement !== undefined && {
      acknowledgement: { statement: input.acknowledgement },
    }),
    catalog: { listed: true },
    certificate: { enabled: false },
  };
  return CourseSchema.parse({
    formatVersion: 1,
    id: 'fictional-course',
    title: 'Handling late deliveries (fictional)',
    type: 'standard',
    settings,
    lessons: input.lessons,
  });
}

export function quizLesson(course: Course, id: string): QuizLesson {
  const lesson = course.lessons.find((candidate) => candidate.id === id);
  if (!lesson || lesson.kind !== 'quiz') throw new Error(`No quiz lesson ${id}`);
  return lesson;
}

/** Records one learner's events; each event happens `after` seconds after the previous one. */
export function learner(startAt = '2026-10-27T09:00:00.000Z') {
  let clock = Date.parse(startAt);
  let count = 0;
  const events: ProgressEvent[] = [];
  const add = (event: NewProgressEvent, after = 1): ProgressEvent => {
    clock += after * 1000;
    const id = `ev-${String(++count).padStart(4, '0')}`;
    const full = { id, at: new Date(clock).toISOString(), ...event } as ProgressEvent;
    events.push(full);
    return full;
  };
  const submit = (lessonId: string, attemptId: string, answers: Record<string, string>) =>
    add({
      type: 'quiz_attempt_submitted',
      lessonId,
      attemptId,
      responses: Object.fromEntries(
        Object.entries(answers).map(([id, optionId]) => [id, { type: 'single_choice', optionId }]),
      ),
    });
  const start = (lesson: QuizLesson, attemptId: string, seed = 7): AttemptPlan => {
    const plan = planAttempt(lesson, seed, attemptId);
    add({ type: 'quiz_attempt_started', lessonId: lesson.id, plan });
    return plan;
  };
  return {
    events,
    add,
    open: (lessonId: string, after = 1) => add({ type: 'lesson_opened', lessonId }, after),
    /** Active time sent as heartbeats of at most 60 s, each after that much wall-clock time. */
    spend(lessonId: string, seconds: number) {
      for (let left = seconds; left > 0; left -= 60) {
        const chunk = Math.min(60, left);
        add({ type: 'time_active', lessonId, seconds: chunk }, chunk);
      }
    },
    pass: (lessonId: string, blockId: string) =>
      add({ type: 'block_completed', lessonId, blockId }),
    answer: (lessonId: string, blockId: string, optionId = 'right') =>
      add({
        type: 'knowledge_check_answered',
        lessonId,
        blockId,
        response: { type: 'single_choice', optionId },
      }),
    play: (lessonId: string, blockId: string, choiceIds: string[]) =>
      add({ type: 'scenario_finished', lessonId, blockId, choiceIds }),
    complete: (lessonId: string) => add({ type: 'lesson_completed', lessonId }),
    acknowledge: (statement: string) => add({ type: 'acknowledged', statement }),
    start,
    submit,
    /** Starts and submits an attempt with the first `right` questions of the plan answered right. */
    take(lesson: QuizLesson, attemptId: string, right: number, seed = 7) {
      const plan = start(lesson, attemptId, seed);
      const answers = plan.questionIds.map((id, index) => [id, index < right ? 'right' : 'wrong']);
      submit(lesson.id, attemptId, Object.fromEntries(answers));
      return plan;
    },
  };
}
