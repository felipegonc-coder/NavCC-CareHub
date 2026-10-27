import { courseOutline, lessonHref, type LearnerCourseState } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { inOrder, learner } from '../player/test-utils';
import { courseFacts, hasStarted, startAction, statusLine, timeLeftLine } from './start';

const locked = { status: 'locked' } as const;
const fresh: LearnerCourseState = {
  ...learner(inOrder, { 'calls-during': locked, 'calls-after': locked, 'calls-quiz': locked }),
  status: 'not_started',
};
const action = (state: LearnerCourseState, course = inOrder) =>
  startAction(course, state, courseOutline(course, state));

describe('startAction', () => {
  it('counts a lesson opened while its event is still waiting as started', () => {
    const opened = learner(inOrder, { 'calls-before': { status: 'in_progress' } });
    const waiting = { ...opened, status: 'not_started' } as const;
    expect(hasStarted(fresh, courseOutline(inOrder, fresh))).toBe(false);
    expect(hasStarted(waiting, courseOutline(inOrder, waiting))).toBe(true);
    expect(action(waiting)).toEqual({
      label: 'Continue',
      href: lessonHref(inOrder.id, 'calls-before'),
    });
  });

  it('goes to the first lesson not done yet when the resume point is gone', () => {
    const state = {
      ...learner(inOrder, { 'calls-before': { status: 'completed' } }),
      resume: { lessonId: 'calls-removed' },
    };
    expect(action(state)?.href).toBe(lessonHref(inOrder.id, 'calls-during'));
  });

  it('offers a look back once the course is finished, passed or not', () => {
    for (const status of ['completed', 'passed', 'failed'] as const) {
      expect(action({ ...fresh, status })).toEqual({
        label: 'Review the course',
        href: lessonHref(inOrder.id, 'calls-before'),
      });
    }
  });

  it('has no button for a course without lessons', () => {
    const empty = { ...inOrder, lessons: [] };
    expect(action(fresh, empty)).toBeNull();
  });
});

describe('statusLine', () => {
  it('says where the learner is, with the score once there is one', () => {
    expect(statusLine(fresh, 0, false)).toBe('Not started');
    expect(statusLine({ ...fresh, status: 'in_progress' }, 50, true)).toBe(
      'In progress · 50% done',
    );
    expect(statusLine({ ...fresh, status: 'completed', score: 70 }, 100, true)).toBe('Completed');
    expect(statusLine({ ...fresh, status: 'passed', score: null }, 100, true)).toBe('Passed');
    expect(statusLine({ ...fresh, status: 'failed', score: 40.4 }, 100, true)).toBe(
      'Not passed · score 40%',
    );
  });
});

describe('timeLeftLine', () => {
  const timed = { settings: { ...inOrder.settings, minimumCourseSeconds: 300 } };

  it('says the minutes left, rounded up, only while the minimum time holds the course back', () => {
    const blocked = { blockedBy: 'minimum_course_time', activeSeconds: 250 } as const;
    expect(timeLeftLine(timed, blocked)).toBe(
      'Almost done: spend 1 more minute in the lessons to finish the course.',
    );
    expect(timeLeftLine(timed, { ...blocked, activeSeconds: 0 })).toContain('5 more minutes');
    expect(timeLeftLine(timed, { blockedBy: null, activeSeconds: 0 })).toBeNull();
  });
});

describe('courseFacts', () => {
  it('counts the lessons and gives the time when the course has one', () => {
    expect(courseFacts(1, 1)).toBe('1 lesson · About 1 minute');
    expect(courseFacts(4)).toBe('4 lessons');
    expect(courseFacts(4, 20)).toBe('4 lessons · About 20 minutes');
  });
});
