import {
  learnerCourse,
  paperAnswerKey,
  planAttempt,
  quizPaper,
  reduceProgress,
  richText,
  sampleStandardCourse,
  type Course,
  type LearnerCourseState,
  type PlayerCourse,
  type ProgressEvent,
  type ProgressRejectReason,
  type QuizLesson,
} from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { progressKey } from '../player/data';
import { QuizLessonView } from './QuizLessonView';

const RIGHT = 'Hi, this is Sam from Brightside Support.';
const WRONG = 'Support, go ahead.';

const graded: QuizLesson = {
  id: 'quiz-final',
  kind: 'quiz',
  title: 'Final quiz',
  intro: richText('Two questions about calls.'),
  settings: {
    passMark: 100,
    maxAttempts: 3,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'never',
  },
  questions: [
    {
      id: 'q-greet',
      type: 'single_choice',
      prompt: richText('Which greeting follows the guide?'),
      points: 1,
      options: [
        { id: 'o-full', text: RIGHT, correct: true },
        {
          id: 'o-short',
          text: WRONG,
          correct: false,
          feedback: richText("Say your name and the team's name."),
        },
      ],
    },
    {
      id: 'q-listen',
      type: 'true_false',
      prompt: richText('Let the member finish before you answer.'),
      points: 1,
      answer: true,
    },
  ],
};

const survey: QuizLesson = {
  ...graded,
  id: 'quiz-survey',
  title: 'How did it go?',
  intro: undefined,
  settings: { ...graded.settings, mode: 'survey', maxAttempts: 1 },
  questions: [
    {
      id: 'q-useful',
      type: 'single_choice',
      prompt: richText('Was this course useful?'),
      points: 1,
      options: [
        { id: 'o-yes', text: 'Yes', correct: false },
        { id: 'o-no', text: 'No', correct: false },
      ],
    },
  ],
};

const courseOf = (lesson: QuizLesson): Course => ({ ...sampleStandardCourse, lessons: [lesson] });
const LONG_AGO = '2020-01-01T09:00:00.000Z';

const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

type Serve = { offline?: 'start' | 'send'; refuse?: ProgressRejectReason };

/**
 * A fake progress server for `course` on `fetch`: attempts are planned and events reduced as the
 * real one does, with the right answers on the attempts while the quiz shows them. `offline`
 * makes starting or sending fail; `refuse` refuses the events sent.
 */
function serve(course: Course, { offline, refuse }: Serve = {}) {
  const lesson = course.lessons[0] as QuizLesson;
  const stored: ProgressEvent[] = [];
  const learnerState = (): LearnerCourseState => {
    const state = reduceProgress(course, stored);
    const quizzes = state.quizzes.map((quiz) =>
      quiz.revealAnswers
        ? {
            ...quiz,
            attempts: quiz.attempts.map((attempt) => ({
              ...attempt,
              answers: paperAnswerKey(lesson, attempt.plan),
            })),
          }
        : quiz,
    );
    return { ...state, quizzes };
  };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    calls.push({ url, body });
    const base = `/api/learning/courses/${course.id}`;
    if (url === `${base}/quizzes/${lesson.id}/attempts`) {
      if (offline === 'start') throw new TypeError('Failed to fetch');
      const plan = planAttempt(lesson, 7, `attempt-${calls.length}`);
      stored.push({
        id: `start-${calls.length}`,
        at: LONG_AGO,
        type: 'quiz_attempt_started',
        lessonId: lesson.id,
        plan,
      });
      return reply(200, { attemptId: plan.attemptId, questions: quizPaper(lesson, plan) });
    }
    if (url === `${base}/events`) {
      if (offline === 'send') throw new TypeError('Failed to fetch');
      const events = body.events as ProgressEvent[];
      if (!refuse) stored.push(...events);
      const rejected = refuse
        ? events.map((event) => ({
            eventId: event.id,
            type: event.type,
            at: event.at,
            reason: refuse,
          }))
        : [];
      return reply(200, { state: learnerState(), rejected });
    }
    return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
  });
  return calls;
}

function show(course: PlayerCourse, state?: LearnerCourseState) {
  const client = new QueryClient();
  const lesson = course.lessons[0];
  if (lesson?.kind !== 'quiz') throw new Error('The course starts with a quiz.');
  render(
    <QueryClientProvider client={client}>
      <QuizLessonView
        course={course}
        lesson={lesson}
        state={state ?? reduceProgress(courseOf(graded), [])}
        emit={vi.fn()}
        go={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return client;
}

const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** The right answers shown under the marked answers, in words. */
const rightAnswers = () =>
  screen
    .queryAllByText('Right answer:')
    .map((label: HTMLElement) => label.parentElement?.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuizLessonView', () => {
  it('says what the quiz asks for and that it needs a connection', () => {
    show(learnerCourse(courseOf(graded)));
    expect(screen.getByText('Two questions about calls.')).toBeInTheDocument();
    expect(screen.getByText('2 questions')).toBeInTheDocument();
    expect(screen.getByText('Pass mark: 100%')).toBeInTheDocument();
    expect(screen.getByText('Up to 3 tries')).toBeInTheDocument();
    expect(
      screen.getByText('You need a connection to start the quiz and to send your answers.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeInTheDocument();
  });

  it('starts an attempt on the server and sends the answers at once', async () => {
    const course = courseOf(graded);
    const calls = serve(course);
    const client = show(learnerCourse(course));
    press('Start quiz');
    const questions = await screen.findByRole('heading', { name: 'Questions' });
    await waitFor(() => expect(questions).toHaveFocus());
    expect(calls[0]?.url).toBe(`/api/learning/courses/${course.id}/quizzes/quiz-final/attempts`);
    expect(typeof calls[0]?.body.at).toBe('string');
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    pick(RIGHT);
    pick('True');
    expect(screen.getByText('2 of 2 answered.')).toBeInTheDocument();
    press('Submit');
    const score = await screen.findByRole('heading', { name: 'Your score: 100%' });
    await waitFor(() => expect(score).toHaveFocus());
    expect(screen.getByText(/You passed\./)).toBeInTheDocument();
    expect(calls[1]?.body.events).toEqual([
      expect.objectContaining({
        type: 'quiz_attempt_submitted',
        lessonId: 'quiz-final',
        attemptId: 'attempt-1',
        responses: {
          'q-greet': { type: 'single_choice', optionId: 'o-full' },
          'q-listen': { type: 'true_false', value: true },
        },
      }),
    ]);
    const saved = client.getQueryData<LearnerCourseState>(progressKey(course.id));
    expect(saved?.quizzes[0]?.passed).toBe(true);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('marks each answer with its feedback and offers another try', async () => {
    const course = courseOf(graded);
    const calls = serve(course);
    show(learnerCourse(course));
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(WRONG);
    press('Submit');
    expect(await screen.findByRole('heading', { name: 'Your score: 0%' })).toBeInTheDocument();
    expect(screen.getByText(/You didn't pass this time\./)).toBeInTheDocument();
    expect(screen.getByText('2 tries left.')).toBeInTheDocument();
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText("Say your name and the team's name.")).toBeInTheDocument();
    expect(screen.getByText('Not answered')).toBeInTheDocument();
    expect(rightAnswers()).toEqual([]);
    expect(screen.getByRole('radio', { name: WRONG })).toBeDisabled();
    press('Try again');
    expect(await screen.findByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    expect(calls).toHaveLength(3);
    expect(screen.getByRole('radio', { name: WRONG })).not.toBeChecked();
  });

  it('keeps the answers when they could not be sent', async () => {
    const course = courseOf(graded);
    serve(course, { offline: 'send' });
    show(learnerCourse(course));
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(RIGHT);
    press('Submit');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't send your answers. Check your connection and try again.",
    );
    expect(screen.getByRole('radio', { name: RIGHT })).toBeChecked();
    expect(screen.getByRole('radio', { name: RIGHT })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Submit' })).not.toHaveAttribute('aria-busy');
  });

  it('says so when the quiz could not start', async () => {
    const course = courseOf(graded);
    serve(course, { offline: 'start' });
    show(learnerCourse(course));
    press('Start quiz');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start the quiz. Check your connection and try again.",
    );
    expect(screen.queryByText('Question 1 of 2')).not.toBeInTheDocument();
  });

  it('says why the server refused the answers, and keeps them', async () => {
    const course = courseOf(graded);
    serve(course, { refuse: 'future' });
    show(learnerCourse(course));
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(RIGHT);
    press('Submit');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Care Hub couldn't count these answers because this device's clock is ahead.",
    );
    expect(screen.getByRole('radio', { name: RIGHT })).toBeChecked();
  });

  it('sends a survey once, with no score', async () => {
    const course = courseOf(survey);
    serve(course);
    show(learnerCourse(course), reduceProgress(course, []));
    expect(
      screen.getByText('A survey: there are no right or wrong answers, and you send it once.'),
    ).toBeInTheDocument();
    press('Start survey');
    await screen.findByText('Question 1 of 1');
    pick('Yes');
    press('Submit');
    expect(
      await screen.findByRole('heading', { name: 'Thanks, your answers are in.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/score/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('plans and scores a draft in the browser', async () => {
    const calls = serve(courseOf(graded));
    show(courseOf(graded));
    expect(
      screen.getByText('Preview: answers are checked here and not saved.'),
    ).toBeInTheDocument();
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(RIGHT);
    pick('True');
    press('Submit');
    expect(await screen.findByRole('heading', { name: 'Your score: 100%' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the right answer under each wrong or missing one when the quiz reveals them', async () => {
    const lesson: QuizLesson = {
      ...graded,
      settings: { ...graded.settings, revealAnswers: 'after_each_attempt' },
    };
    show(courseOf(lesson));
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(WRONG);
    press('Submit');
    expect(await screen.findByRole('heading', { name: 'Your score: 0%' })).toBeInTheDocument();
    expect(rightAnswers()).toEqual([`Right answer: ${RIGHT}`, 'Right answer: True']);
    press('Try again');
    await screen.findByRole('heading', { name: 'Questions' });
    pick(RIGHT);
    pick('True');
    press('Submit');
    expect(await screen.findByRole('heading', { name: 'Your score: 100%' })).toBeInTheDocument();
    expect(rightAnswers()).toEqual([]);
  });

  it('shows the right answers the server keeps on the attempt', async () => {
    const course = courseOf({
      ...graded,
      settings: { ...graded.settings, revealAnswers: 'after_each_attempt' },
    });
    serve(course);
    show(learnerCourse(course), reduceProgress(course, []));
    press('Start quiz');
    await screen.findByText('Question 1 of 2');
    pick(WRONG);
    pick('True');
    press('Submit');
    expect(await screen.findByRole('heading', { name: 'Your score: 50%' })).toBeInTheDocument();
    expect(rightAnswers()).toEqual([`Right answer: ${RIGHT}`]);
  });

  it('shows where the learner stands after passing', () => {
    const course = courseOf(graded);
    const plan = planAttempt(graded, 7, 'attempt-1');
    const state = reduceProgress(course, [
      { id: 'start', at: LONG_AGO, type: 'quiz_attempt_started', lessonId: graded.id, plan },
      {
        id: 'send',
        at: '2020-01-01T09:05:00.000Z',
        type: 'quiz_attempt_submitted',
        lessonId: graded.id,
        attemptId: 'attempt-1',
        responses: {
          'q-greet': { type: 'single_choice', optionId: 'o-full' },
          'q-listen': { type: 'true_false', value: true },
        },
      },
    ]);
    show(learnerCourse(course), state);
    expect(screen.getByText('You passed. Your best score is 100%.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
