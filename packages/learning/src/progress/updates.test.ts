// Course update notices for new live versions, and manual completion.
import { describe, expect, it } from 'vitest';
import { courseUpdateFor, reduceProgress, withManualCompletion } from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

const course = { id: 'late-deliveries', title: 'Handling late deliveries (fictional)' };

describe('courseUpdateFor', () => {
  it('leaves learners alone with notify none, and anyone who has not started', () => {
    const nothing = { restart: false, notice: null };
    expect(courseUpdateFor('none', { status: 'in_progress' }, course)).toEqual(nothing);
    expect(courseUpdateFor('tell', { status: 'not_started' }, course)).toEqual(nothing);
    expect(courseUpdateFor('retake', { status: 'not_started' }, course)).toEqual(nothing);
  });

  it('tell: keeps progress and sends an alert', () => {
    expect(courseUpdateFor('tell', { status: 'in_progress' }, course)).toEqual({
      restart: false,
      notice: {
        kind: 'alert',
        title: 'Course updated',
        text: '“Handling late deliveries (fictional)” has a new version. Your progress is kept.',
        buttons: [{ label: 'Open course', href: '/learning/courses/late-deliveries' }],
      },
    });
  });

  it('retake: starts over for everyone who started, with the note at the end', () => {
    for (const status of ['in_progress', 'completed', 'passed', 'failed'] as const) {
      const update = courseUpdateFor(
        'retake',
        { status },
        { ...course, note: '  New refund rules. ' },
      );
      expect(update.restart).toBe(true);
      expect(update.notice).toMatchObject({
        kind: 'reminder',
        title: 'Please take this course again',
        text:
          '“Handling late deliveries (fictional)” has a new version, so your progress starts ' +
          'over. Please take it again. New refund rules.',
      });
    }
    const blankNote = courseUpdateFor('tell', { status: 'passed' }, { ...course, note: '   ' });
    expect(blankNote.notice?.text.endsWith('Your progress is kept.')).toBe(true);
  });
});

describe('withManualCompletion', () => {
  const graded = makeCourse({
    lessons: [content('l1', [blocks.paragraph('p1')]), quiz('quiz', { maxAttempts: 1 })],
    completion: { requireQuizPass: true },
  });
  const marked = { at: '2026-10-28T10:00:00.000Z' };

  it('completes a course that was not finished, or was failed', () => {
    const fresh = reduceProgress(graded, []);
    expect(withManualCompletion(fresh, marked)).toMatchObject({
      status: 'completed',
      completedAt: marked.at,
      percentComplete: 100,
      resume: null,
      blockedBy: null,
      startedAt: null,
    });

    const l = learner();
    l.complete('l1');
    l.take(quizLesson(graded, 'quiz'), 'a1', 1);
    const failed = reduceProgress(graded, l.events);
    expect(failed).toMatchObject({ status: 'failed', score: 20 });
    expect(withManualCompletion(failed, marked)).toMatchObject({
      status: 'completed',
      completedAt: marked.at,
      score: 20,
      quizzes: failed.quizzes,
      lessons: failed.lessons,
    });
  });

  it('keeps an earlier finish, and the manual date over a later one', () => {
    const l = learner('2026-10-27T09:00:00.000Z');
    l.complete('l1');
    l.take(quizLesson(graded, 'quiz'), 'a1', 5);
    const passed = reduceProgress(graded, l.events);
    expect(passed.status).toBe('passed');
    expect(withManualCompletion(passed, marked)).toBe(passed);
    expect(withManualCompletion(passed, null)).toBe(passed);

    const earlier = { at: '2026-10-26T09:00:00.000Z' };
    expect(withManualCompletion(passed, earlier)).toMatchObject({
      status: 'completed',
      completedAt: earlier.at,
      score: 100,
    });
  });
});
