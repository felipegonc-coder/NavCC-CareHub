import {
  DEFAULT_ACKNOWLEDGEMENT,
  courseOutline,
  lessonHref,
  sampleRequiredReadCourse,
  type LearnerCourseState,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { inOrder, learner } from '../player/test-utils';
import {
  RESUME_STATE,
  almostDoneLine,
  courseFacts,
  hasStarted,
  resumeHref,
  signOff,
  startAction,
  statusLine,
  wantsResume,
} from './start';

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

  it('offers a look back once every lesson is done, while something else is left', () => {
    const allDone = learner(inOrder, {
      'calls-before': { status: 'completed' },
      'calls-during': { status: 'completed' },
      'calls-after': { status: 'completed' },
      'calls-quiz': { status: 'completed' },
    });
    expect(action({ ...allDone, resume: { lessonId: 'calls-after' } })).toEqual({
      label: 'Review the course',
      href: lessonHref(inOrder.id, 'calls-before'),
    });
  });

  it('has no button for a course without lessons', () => {
    const empty = { ...inOrder, lessons: [] };
    expect(action(fresh, empty)).toBeNull();
  });
});

describe('resumeHref', () => {
  const resume = (state: LearnerCourseState) =>
    resumeHref(inOrder, state, courseOutline(inOrder, state));

  it('is where the learner stopped while they are part way through', () => {
    const state = {
      ...learner(inOrder, { 'calls-before': { status: 'completed' } }),
      resume: { lessonId: 'calls-during', blockId: 'calls-during-check' },
    };
    expect(resume(state)).toBe(lessonHref(inOrder.id, 'calls-during', 'calls-during-check'));
  });

  it('is null before the learner begins, and once the course or every lesson is done', () => {
    const allDone = learner(inOrder, {
      'calls-before': { status: 'completed' },
      'calls-during': { status: 'completed' },
      'calls-after': { status: 'completed' },
      'calls-quiz': { status: 'completed' },
    });
    expect(resume(fresh)).toBeNull();
    expect(resume({ ...fresh, status: 'failed' })).toBeNull();
    expect(resume({ ...allDone, resume: { lessonId: 'calls-after' } })).toBeNull();
  });

  it('is asked for only with the resume state', () => {
    expect(wantsResume(RESUME_STATE)).toBe(true);
    for (const other of [null, undefined, 'resume', { resume: 'true' }, {}]) {
      expect(wantsResume(other)).toBe(false);
    }
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

describe('signOff', () => {
  const course = sampleRequiredReadCourse;
  const quizLeft = learner(course, { 'privacy-rules': { status: 'completed' } });

  it('is ready once every content lesson is completed, with the quiz still to do', () => {
    expect(signOff(course, learner(course))).toEqual({
      statement: 'I have read the privacy basics and will follow them.',
      ready: false,
      signedAt: null,
    });
    expect(signOff(course, quizLeft)?.ready).toBe(true);
    const signed = { ...quizLeft, acknowledgedAt: '2026-10-27T09:00:00.000Z' };
    expect(signOff(course, signed)?.signedAt).toBe('2026-10-27T09:00:00.000Z');
  });

  it("is missing when the course doesn't ask for one, and has words when it lacks them", () => {
    expect(signOff(inOrder, learner(inOrder))).toBeNull();
    const settings = { ...course.settings };
    delete settings.acknowledgement;
    expect(signOff({ ...course, settings }, quizLeft)?.statement).toBe(DEFAULT_ACKNOWLEDGEMENT);
  });
});

describe('almostDoneLine', () => {
  const timed = { settings: { ...inOrder.settings, minimumCourseSeconds: 300 } };
  const allDone = { completed: 4, total: 4 };

  it('says the minutes left, rounded up, only while the minimum time holds the course back', () => {
    const blocked = {
      status: 'in_progress',
      blockedBy: 'minimum_course_time',
      activeSeconds: 250,
    } as const;
    expect(almostDoneLine(timed, blocked, allDone, null)).toBe(
      'Almost done: spend 1 more minute in the lessons to finish the course.',
    );
    expect(almostDoneLine(timed, { ...blocked, activeSeconds: 0 }, allDone, null)).toContain(
      '5 more minutes',
    );
    expect(almostDoneLine(timed, { ...blocked, blockedBy: null }, allDone, null)).toBeNull();
  });

  it('asks for the sign-off once it is all that is left', () => {
    const state = { status: 'in_progress', blockedBy: null, activeSeconds: 0 } as const;
    const sign = { statement: 'I agree.', ready: true, signedAt: null };
    expect(almostDoneLine(timed, state, allDone, sign)).toBe(
      'Almost done: sign below to finish the course.',
    );
    expect(almostDoneLine(timed, state, { completed: 3, total: 4 }, sign)).toBeNull();
    expect(almostDoneLine(timed, state, allDone, { ...sign, signedAt: '2026-10-27' })).toBeNull();
    expect(almostDoneLine(timed, { ...state, status: 'failed' }, allDone, sign)).toBeNull();
  });
});

describe('courseFacts', () => {
  it('counts the lessons and gives the time when the course has one', () => {
    expect(courseFacts(1, 1)).toBe('1 lesson · About 1 minute');
    expect(courseFacts(4)).toBe('4 lessons');
    expect(courseFacts(4, 20)).toBe('4 lessons · About 20 minutes');
  });
});
