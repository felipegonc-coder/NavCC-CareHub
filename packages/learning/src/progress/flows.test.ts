// The Phase 1 test flows, played against reduceProgress.
import { describe, expect, it } from 'vitest';
import { presetFor, type CourseType } from '../format/index';
import { canCompleteLesson, reduceProgress } from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

const reasons = (state: ReturnType<typeof reduceProgress>) =>
  state.rejected.map((rejection) => [rejection.eventId, rejection.reason]);
const statuses = (state: ReturnType<typeof reduceProgress>) =>
  state.lessons.map((lesson) => [lesson.lessonId, lesson.status]);

/** A course with the preset settings of its type and the preset quiz settings. */
function presetCourse(type: CourseType, lessons: unknown[], questions = 5) {
  const preset = presetFor(type, { hasQuiz: true });
  const withQuiz = [...lessons, quiz('quiz', preset.quiz, questions)];
  return makeCourse({ settings: preset.settings, lessons: withQuiz });
}

describe('Phase 1 flows', () => {
  it('60-second minimum on lesson 1: too early, then fine', () => {
    const course = makeCourse({
      lessons: [
        content('l1', [blocks.paragraph('p1')], { minimumSeconds: 60 }),
        content('l2', [blocks.paragraph('p2')]),
      ],
    });
    const l = learner();
    l.open('l1');
    l.spend('l1', 45);
    l.complete('l1');
    const early = reduceProgress(course, l.events);
    expect(early.rejected.map((r) => [r.reason, r.secondsLeft])).toEqual([['minimum_time', 15]]);
    expect(early.lessons[0]).toMatchObject({ status: 'in_progress', minimumMet: false });
    expect(canCompleteLesson(course, early, 'l1')).toEqual({
      ok: false,
      reason: 'minimum_time',
      secondsLeft: 15,
    });

    l.spend('l1', 15);
    l.complete('l1');
    const fine = reduceProgress(course, l.events);
    expect(fine.rejected).toHaveLength(1);
    expect(fine.lessons[0]).toMatchObject({
      status: 'completed',
      minimumMet: true,
      activeSeconds: 60,
    });
    expect(fine).toMatchObject({
      status: 'in_progress',
      percentComplete: 50,
      resume: { lessonId: 'l2' },
    });
  });

  it('stopping halfway and resuming', () => {
    const course = presetCourse('standard', [
      content('l1', [blocks.paragraph('p1'), blocks.check('kc1'), blocks.continue('c1')]),
      content('l2', [
        blocks.paragraph('p2'),
        blocks.continue('c2'),
        blocks.check('kc2'),
        blocks.continue('c3', 'complete_above'),
        blocks.paragraph('p3'),
      ]),
    ]);
    const computer = learner();
    computer.open('l1');
    computer.answer('l1', 'kc1');
    computer.pass('l1', 'c1');
    computer.complete('l1');
    computer.open('l2');
    computer.pass('l2', 'c2');
    const halfway = reduceProgress(course, computer.events);
    expect(halfway.rejected).toEqual([]);
    expect(halfway).toMatchObject({ status: 'in_progress', percentComplete: 33 });
    expect(statuses(halfway)).toEqual([
      ['l1', 'completed'],
      ['l2', 'in_progress'],
      ['quiz', 'not_started'],
    ]);
    // Back at the first continue block still closed, below what was already read.
    expect(halfway.resume).toEqual({ lessonId: 'l2', blockId: 'c3' });

    // Later, on a phone: the server replays everything it has.
    const phone = computer;
    phone.open('l2', 3_600);
    phone.answer('l2', 'kc2', false);
    phone.pass('l2', 'c3');
    phone.complete('l2');
    expect(reduceProgress(course, phone.events).resume).toEqual({ lessonId: 'quiz' });
    phone.open('quiz');
    phone.take(quizLesson(course, 'quiz'), 'a1', 4);
    const done = reduceProgress(course, phone.events);
    expect(done.rejected).toEqual([]);
    expect(done).toMatchObject({ status: 'passed', percentComplete: 100, score: 80, resume: null });
    expect(done.completedAt).toBe(phone.events.at(-1)?.at);
  });

  it('failing once then passing', () => {
    const course = presetCourse('standard', [content('l1', [blocks.paragraph('p1')])]);
    const quizLessonOne = quizLesson(course, 'quiz');
    const l = learner();
    l.complete('l1');
    l.take(quizLessonOne, 'a1', 2);
    const failedOnce = reduceProgress(course, l.events);
    expect(failedOnce).toMatchObject({ status: 'in_progress', score: 40, percentComplete: 50 });
    expect(failedOnce.quizzes[0]).toMatchObject({
      attemptsUsed: 1,
      attemptsRemaining: null,
      passed: false,
      canRetry: true,
      revealAnswers: true,
      failed: false,
    });
    expect(failedOnce.resume).toEqual({ lessonId: 'quiz' });

    l.take(quizLessonOne, 'a2', 5, 8);
    const passed = reduceProgress(course, l.events);
    expect(passed).toMatchObject({ status: 'passed', score: 100, percentComplete: 100 });
    expect(passed.quizzes[0]?.attempts.map((a) => [a.attemptId, a.result.percent])).toEqual([
      ['a1', 40],
      ['a2', 100],
    ]);
    expect(passed.lessons[1]?.completedAt).toBe(l.events.at(-1)?.at);
  });

  it('required read with acknowledgement', () => {
    const course = presetCourse('required_read', [
      content('l1', [blocks.paragraph('p1')]),
      content('l2', [blocks.paragraph('p2')]),
    ]);
    const statement = course.settings.acknowledgement?.statement ?? '';
    expect(course.settings).toMatchObject({
      lessonOrder: 'sequential',
      completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: true },
    });
    const l = learner();
    l.open('l2');
    l.acknowledge(statement);
    l.complete('l1');
    l.complete('l2');
    l.acknowledge('I skimmed it.');
    const read = reduceProgress(course, l.events);
    expect(read.rejected.map((r) => [r.reason, r.lessonIds])).toEqual([
      ['locked', undefined],
      ['not_ready', ['l1', 'l2']],
      ['bad_statement', undefined],
    ]);
    expect(statuses(read)).toEqual([
      ['l1', 'completed'],
      ['l2', 'completed'],
      ['quiz', 'not_started'],
    ]);

    l.acknowledge(statement);
    l.take(quizLesson(course, 'quiz'), 'a1', 4);
    const almost = reduceProgress(course, l.events);
    expect(almost.acknowledgedAt).toBe(l.events.at(-3)?.at);
    // The preset asks for 100 %: 4 out of 5 isn't enough, and there are unlimited tries.
    expect(almost).toMatchObject({ status: 'in_progress', score: 80 });
    expect(almost.quizzes[0]).toMatchObject({
      passed: false,
      revealAnswers: false,
      canRetry: true,
    });

    l.take(quizLesson(course, 'quiz'), 'a2', 5, 9);
    const done = reduceProgress(course, l.events);
    expect(done).toMatchObject({ status: 'passed', score: 100, resume: null });
    expect(done.completedAt).toBe(l.events.at(-1)?.at);
    expect(done.quizzes[0]?.revealAnswers).toBe(true);
  });

  describe('certification attempt limits', () => {
    const course = presetCourse('certification', [content('l1', [blocks.paragraph('p1')])], 10);
    const exam = quizLesson(course, 'quiz');

    it('fails the course on the third failed try and refuses a fourth', () => {
      expect(exam.settings).toMatchObject({ passMark: 90, maxAttempts: 3, shuffleQuestions: true });
      const l = learner();
      l.take(exam, 'too-early', 10);
      l.complete('l1');
      l.take(exam, 'a1', 8, 1);
      l.take(exam, 'a2', 8, 2);
      const twice = reduceProgress(course, l.events);
      expect(twice.quizzes[0]).toMatchObject({ attemptsRemaining: 1, revealAnswers: false });
      l.take(exam, 'a3', 7, 3);
      l.take(exam, 'a4', 10, 4);
      const state = reduceProgress(course, l.events);
      expect(reasons(state)).toEqual([
        ['ev-0001', 'locked'],
        ['ev-0002', 'locked'],
        ['ev-0010', 'no_attempts_left'],
        ['ev-0011', 'unknown_attempt'],
      ]);
      expect(state).toMatchObject({
        status: 'failed',
        score: 80,
        percentComplete: 100,
        resume: null,
      });
      expect(state.completedAt).toBe(l.events[8]?.at);
      expect(state.quizzes[0]).toMatchObject({
        attemptsUsed: 3,
        attemptsRemaining: 0,
        bestPercent: 80,
        passed: false,
        failed: true,
        canRetry: false,
        revealAnswers: true,
      });
    });

    it('passes with 90 % on the second try', () => {
      const l = learner();
      l.complete('l1');
      l.take(exam, 'a1', 8, 1);
      l.take(exam, 'a2', 9, 2);
      const state = reduceProgress(course, l.events);
      expect(state).toMatchObject({ status: 'passed', score: 90 });
      expect(state.quizzes[0]).toMatchObject({ attemptsRemaining: 1, passed: true, failed: false });
    });
  });

  it('scores questions drawn from a bank like the lesson’s own questions', () => {
    const bank = [1, 2, 3, 4].map((n) => ({ ...quiz('x').questions[0], id: `bank-q${n}` }));
    const course = makeCourse({
      completion: { requireQuizPass: true },
      lessons: [
        {
          ...quiz('q1', {}, 2),
          bankDraws: [{ bankId: 'fictional-bank', count: 2, questions: bank }],
        },
      ],
    });
    const q1 = quizLesson(course, 'q1');
    const l = learner();
    const plan = l.start(q1, 'a1');
    const drawn = plan.questionIds.filter((id) => id.startsWith('bank-'));
    expect(plan.questionIds).toHaveLength(4);
    expect(drawn).toHaveLength(2);
    // Own questions right, bank questions wrong: 2 of 4.
    l.submit('q1', 'a1', {
      'q1-q1': 'right',
      'q1-q2': 'right',
      ...Object.fromEntries(drawn.map((id) => [id, 'wrong'])),
    });
    const state = reduceProgress(course, l.events);
    expect(state.rejected).toEqual([]);
    expect(state.quizzes[0]?.attempts[0]?.result).toMatchObject({ earned: 2, max: 4, percent: 50 });
    l.take(q1, 'a2', 4, 11);
    expect(reduceProgress(course, l.events)).toMatchObject({ status: 'passed', score: 100 });
  });
});
