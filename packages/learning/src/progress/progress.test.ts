import { describe, expect, it } from 'vitest';
import { nextLesson, reduceProgress } from './index';
import { blocks, content, learner, makeCourse, quiz, quizLesson } from './test-helpers';

type State = ReturnType<typeof reduceProgress>;
const reasons = (state: State) => state.rejected.map((r) => [r.eventId, r.reason]);
const statuses = (state: State) => state.lessons.map((l) => [l.lessonId, l.status]);

const course = makeCourse({
  completion: { requireAllLessons: true, requireQuizPass: true },
  lessons: [
    content('l1', [blocks.paragraph('p1'), blocks.check('kc1'), blocks.continue('c1')]),
    content('l2', [blocks.paragraph('p2')]),
    quiz('q3'),
  ],
});

describe('reduceProgress', () => {
  it('starts with nothing done', () => {
    const state = reduceProgress(course, []);
    expect(state).toMatchObject({
      courseId: 'fictional-course',
      status: 'not_started',
      blockedBy: null,
      startedAt: null,
      completedAt: null,
      percentComplete: 0,
      score: null,
      resume: { lessonId: 'l1', blockId: 'c1' },
    });
    expect(statuses(state)).toEqual([
      ['l1', 'not_started'],
      ['l2', 'not_started'],
      ['q3', 'not_started'],
    ]);
    expect(state.quizzes).toHaveLength(1);
    expect(state.quizzes[0]).toMatchObject({
      lessonId: 'q3',
      mode: 'graded',
      attemptsUsed: 0,
      openAttempt: null,
    });
  });

  it('gives the same state whatever order the events arrive in', () => {
    const l = learner();
    l.open('l1');
    l.answer('l1', 'kc1');
    l.pass('l1', 'c1');
    l.complete('l1');
    l.take(quizLesson(course, 'q3'), 'a1', 5);
    const state = reduceProgress(course, l.events);
    expect(state).toMatchObject({ status: 'in_progress', startedAt: l.events[0]?.at });
    expect(reduceProgress(course, [...l.events].reverse())).toEqual(state);
    const shuffled = [l.events[4], l.events[0], l.events[5], l.events[2], l.events[1], l.events[3]];
    expect(reduceProgress(course, shuffled)).toEqual(state);
  });

  it('lists events it cannot read without changing anything', () => {
    const state = reduceProgress(course, [
      null,
      'lesson_opened',
      { type: 'lesson_opened', lessonId: 'l1' },
      { id: 'x1', at: 'yesterday', type: 'lesson_opened', lessonId: 'l1' },
      { id: 'x2', at: '2026-10-27T09:00:00Z', type: 'lesson_flipped', lessonId: 'l1' },
      { id: 'x3', at: '2026-10-27T09:00:00Z', type: 'time_active', lessonId: 'l1', seconds: -5 },
    ]);
    expect(state.status).toBe('not_started');
    expect(state.rejected.map((r) => [r.eventId, r.type, r.at, r.reason])).toEqual([
      [null, null, null, 'invalid_event'],
      [null, null, null, 'invalid_event'],
      [null, 'lesson_opened', null, 'invalid_event'],
      ['x1', 'lesson_opened', 'yesterday', 'invalid_event'],
      ['x2', 'lesson_flipped', '2026-10-27T09:00:00Z', 'invalid_event'],
      ['x3', 'time_active', '2026-10-27T09:00:00Z', 'invalid_event'],
    ]);
  });

  it('rejects events for lessons and blocks that do not fit', () => {
    const l = learner();
    l.open('nope');
    l.pass('l1', 'missing');
    l.pass('l1', 'p1');
    l.answer('l1', 'c1');
    l.pass('q3', 'c1');
    l.complete('q3');
    l.start(quizLesson(course, 'q3'), 'a1');
    l.add({ type: 'quiz_attempt_submitted', lessonId: 'l1', attemptId: 'a1', responses: {} });
    expect(reasons(reduceProgress(course, l.events))).toEqual([
      ['ev-0001', 'unknown_lesson'],
      ['ev-0002', 'unknown_block'],
      ['ev-0003', 'wrong_block_type'],
      ['ev-0004', 'wrong_block_type'],
      ['ev-0005', 'wrong_lesson_kind'],
      ['ev-0006', 'wrong_lesson_kind'],
      ['ev-0008', 'wrong_lesson_kind'],
    ]);
  });
});

describe('lesson order and continue blocks', () => {
  const sequential = makeCourse({
    lessonOrder: 'sequential',
    lessons: [
      content('l1', [blocks.scenario('sc1', 'l3'), blocks.continue('c1')]),
      content('l2', [blocks.paragraph('p2')]),
      content('l3', [blocks.paragraph('p3')]),
    ],
  });

  it('unlocks a lesson once every earlier lesson is completed', () => {
    const l = learner();
    l.open('l2');
    l.complete('l1');
    const early = reduceProgress(sequential, l.events);
    expect(statuses(early)).toEqual([
      ['l1', 'not_started'],
      ['l2', 'locked'],
      ['l3', 'locked'],
    ]);
    expect(early.rejected.map((r) => [r.reason, r.blockIds])).toEqual([
      ['locked', undefined],
      ['continue_blocks', ['c1']],
    ]);
    l.pass('l1', 'c1');
    l.complete('l1');
    const later = reduceProgress(sequential, l.events);
    expect(statuses(later)).toEqual([
      ['l1', 'completed'],
      ['l2', 'not_started'],
      ['l3', 'locked'],
    ]);
    expect(later.resume).toEqual({ lessonId: 'l2' });
  });

  it('unlocks the lesson a finished scenario jumps to, and Next follows the jump', () => {
    const l = learner();
    l.play('l1', 'sc1', ['bad']);
    expect(nextLesson(sequential, reduceProgress(sequential, l.events), 'l1')).toBeNull();
    l.play('l1', 'sc1', ['again', 'jump']);
    const jumped = reduceProgress(sequential, l.events);
    expect(jumped.scenarios[0]).toMatchObject({
      runs: 2,
      lessonJump: 'l3',
      outcome: null,
      score: 1,
    });
    expect(statuses(jumped)).toEqual([
      ['l1', 'in_progress'],
      ['l2', 'locked'],
      ['l3', 'not_started'],
    ]);
    expect(nextLesson(sequential, jumped, 'l1')).toBe('l3');
    l.open('l3');
    l.complete('l3');
    const after = reduceProgress(sequential, l.events);
    expect(after.lessons[2]?.status).toBe('completed');
    expect(after.resume).toEqual({ lessonId: 'l1', blockId: 'c1' });
  });

  it('does not unlock lessons a button points at', () => {
    const buttons = makeCourse({
      lessonOrder: 'sequential',
      lessons: [
        content('l1', [blocks.button('b1', 'l2')]),
        content('l2', [blocks.paragraph('p2')]),
      ],
    });
    const l = learner();
    l.open('l1');
    l.open('l2');
    expect(statuses(reduceProgress(buttons, l.events))).toEqual([
      ['l1', 'in_progress'],
      ['l2', 'locked'],
    ]);
  });

  it('hides blocks behind a continue block and makes complete_above wait for the blocks above', () => {
    const gated = makeCourse({
      lessons: [
        content('l1', [
          blocks.check('kc1'),
          blocks.process('pr1'),
          blocks.continue('c1', 'complete_above'),
          blocks.check('kc2'),
          blocks.continue('c2'),
        ]),
      ],
    });
    const l = learner();
    l.answer('l1', 'kc2');
    l.pass('l1', 'c1');
    l.answer('l1', 'kc1', 'wrong');
    l.pass('l1', 'pr1');
    l.pass('l1', 'c1');
    l.complete('l1');
    const state = reduceProgress(gated, l.events);
    expect(state.rejected.map((r) => [r.eventId, r.reason, r.blockIds])).toEqual([
      ['ev-0001', 'hidden', undefined],
      ['ev-0002', 'not_ready', ['kc1', 'pr1']],
      ['ev-0006', 'continue_blocks', ['c2']],
    ]);
    expect(state.lessons[0]?.completedBlockIds).toEqual(['kc1', 'pr1', 'c1']);
    expect(state.resume).toEqual({ lessonId: 'l1', blockId: 'c2' });
  });
});

describe('course requirements', () => {
  it('waits for the course minimum time with blockedBy, and completes on the event that meets it', () => {
    const timed = makeCourse({
      minimumCourseSeconds: 120,
      lessons: [content('l1', [blocks.paragraph('p1')])],
    });
    const l = learner();
    l.open('l1');
    l.spend('l1', 30);
    l.complete('l1');
    const waiting = reduceProgress(timed, l.events);
    expect(waiting).toMatchObject({
      status: 'in_progress',
      blockedBy: 'minimum_course_time',
      percentComplete: 100,
      completedAt: null,
      resume: { lessonId: 'l1' },
    });
    l.spend('l1', 90);
    const done = reduceProgress(timed, l.events);
    expect(done).toMatchObject({ status: 'completed', blockedBy: null, activeSeconds: 120 });
    expect(done.completedAt).toBe(l.events.at(-1)?.at);
  });

  it('completes a quiz lesson when it runs out of attempts, and the course when no pass is needed', () => {
    const relaxed = makeCourse({
      completion: { requireAllLessons: true, requireQuizPass: false },
      lessons: [content('l1', [blocks.paragraph('p1')]), quiz('q1', { maxAttempts: 2 })],
    });
    const q1 = quizLesson(relaxed, 'q1');
    const l = learner();
    l.complete('l1');
    l.take(q1, 'a1', 1);
    expect(reduceProgress(relaxed, l.events)).toMatchObject({ status: 'in_progress', score: 20 });
    l.take(q1, 'a2', 3, 8);
    const state = reduceProgress(relaxed, l.events);
    expect(state).toMatchObject({ status: 'completed', score: 60, percentComplete: 100 });
    expect(state.quizzes[0]).toMatchObject({ failed: true, passed: false, attemptsRemaining: 0 });
  });

  it('needs only the quiz when requireAllLessons is off, and averages the best of each graded quiz', () => {
    const twoQuizzes = makeCourse({
      completion: { requireAllLessons: false, requireQuizPass: true },
      lessons: [
        content('l1', [blocks.paragraph('p1')]),
        quiz('q1'),
        quiz('q2', { passMark: 50 }, 4),
        quiz('s1', { mode: 'survey' }, 2),
      ],
    });
    const l = learner();
    l.take(quizLesson(twoQuizzes, 'q1'), 'a1', 4);
    l.take(quizLesson(twoQuizzes, 'q2'), 'b1', 1);
    const one = reduceProgress(twoQuizzes, l.events);
    expect(one).toMatchObject({ status: 'in_progress', score: 52.5, percentComplete: 25 });
    l.take(quizLesson(twoQuizzes, 'q2'), 'b2', 3, 8);
    const state = reduceProgress(twoQuizzes, l.events);
    expect(state).toMatchObject({ status: 'passed', score: 77.5, percentComplete: 50 });
    expect(state.resume).toBeNull();
  });

  it('counts a survey as done once sent, never as a pass, and leaves it out of the score', () => {
    const surveyed = makeCourse({
      completion: { requireAllLessons: true, requireQuizPass: true },
      lessons: [quiz('q1'), quiz('s1', { mode: 'survey', passMark: 0 }, 2)],
    });
    const l = learner();
    l.take(quizLesson(surveyed, 'q1'), 'a1', 5);
    expect(reduceProgress(surveyed, l.events)).toMatchObject({ status: 'in_progress', score: 100 });
    l.take(quizLesson(surveyed, 's1'), 's-1', 0);
    l.start(quizLesson(surveyed, 's1'), 's-2');
    const state = reduceProgress(surveyed, l.events);
    expect(state).toMatchObject({ status: 'passed', score: 100, percentComplete: 100 });
    expect(state.quizzes[1]).toMatchObject({
      mode: 'survey',
      attemptsUsed: 1,
      attemptsRemaining: 0,
      passed: false,
      failed: false,
    });
    expect(reasons(state)).toEqual([['ev-0005', 'no_attempts_left']]);
  });
});

describe('quiz attempts', () => {
  const limited = makeCourse({
    completion: { requireQuizPass: true },
    lessons: [quiz('q1', { maxAttempts: 2 })],
  });
  const q1 = quizLesson(limited, 'q1');

  it('keeps one attempt open at a time and only takes submissions for it', () => {
    const l = learner();
    const plan = l.start(q1, 'a1');
    const open = reduceProgress(limited, l.events);
    expect(open.quizzes[0]?.openAttempt).toEqual({ plan, startedAt: l.events[0]?.at });
    expect(open.lessons[0]?.status).toBe('in_progress');
    l.start(q1, 'a2');
    l.submit('q1', 'a9', {});
    l.submit('q1', 'a1', { 'q1-q1': 'right', 'not-in-quiz': 'right' });
    l.submit('q1', 'a1', {});
    const state = reduceProgress(limited, l.events);
    expect(reasons(state)).toEqual([
      ['ev-0002', 'attempt_open'],
      ['ev-0003', 'unknown_attempt'],
      ['ev-0005', 'unknown_attempt'],
    ]);
    expect(state.quizzes[0]).toMatchObject({ attemptsUsed: 1, bestPercent: 20, openAttempt: null });
    // Answers to questions outside the attempt are dropped.
    expect(state.quizzes[0]?.attempts[0]?.responses).toEqual({
      'q1-q1': { type: 'single_choice', optionId: 'right' },
    });
  });
});

describe('knowledge checks, scenarios and acknowledgement', () => {
  it('records knowledge check answers and respects allowRetry', () => {
    const checks = makeCourse({
      lessons: [content('l1', [blocks.check('once', false), blocks.check('again')])],
    });
    const l = learner();
    l.answer('l1', 'once', 'wrong');
    l.answer('l1', 'once', 'right');
    l.answer('l1', 'again', 'wrong');
    l.answer('l1', 'again', 'right');
    l.add({
      type: 'knowledge_check_answered',
      lessonId: 'l1',
      blockId: 'again',
      response: { type: 'true_false', value: true },
    });
    const state = reduceProgress(checks, l.events);
    expect(reasons(state)).toEqual([
      ['ev-0002', 'already_answered'],
      ['ev-0005', 'bad_response'],
    ]);
    expect(
      state.knowledgeChecks.map((k) => [k.blockId, k.answers, k.firstCorrect, k.result.correct]),
    ).toEqual([
      ['once', 1, false, false],
      ['again', 2, false, true],
    ]);
    expect(state.knowledgeChecks[1]).toMatchObject({
      firstAnsweredAt: l.events[2]?.at,
      lastAnsweredAt: l.events[3]?.at,
    });
    expect(state.score).toBeNull();
  });

  it('replays scenario choices and refuses runs that do not end', () => {
    const scenarios = makeCourse({ lessons: [content('l1', [blocks.scenario('sc1')])] });
    const l = learner();
    l.play('l1', 'sc1', ['bad']);
    l.play('l1', 'sc1', []);
    l.play('l1', 'sc1', ['nope']);
    l.play('l1', 'sc1', ['again']);
    l.play('l1', 'sc1', ['good', 'bad']);
    l.play('l1', 'sc1', ['again', 'good']);
    const state = reduceProgress(scenarios, l.events);
    expect(reasons(state)).toEqual([
      ['ev-0002', 'bad_choices'],
      ['ev-0003', 'bad_choices'],
      ['ev-0004', 'bad_choices'],
      ['ev-0005', 'bad_choices'],
    ]);
    expect(state.scenarios).toHaveLength(1);
    expect(state.scenarios[0]).toMatchObject({
      runs: 2,
      bestScore: 5,
      score: 5,
      maxScore: 5,
      passed: true,
      outcome: 'great',
      choiceIds: ['again', 'good'],
      lastFinishedAt: l.events.at(-1)?.at,
    });
    expect(state.lessons[0]?.completedBlockIds).toEqual(['sc1']);
  });

  const statement = 'I have read the fictional late delivery policy.';

  it('takes the acknowledgement only when the course asks for one', () => {
    const optional = makeCourse({
      acknowledgement: statement,
      lessons: [content('l1', [blocks.paragraph('p1')])],
    });
    const l = learner();
    l.complete('l1');
    l.acknowledge(statement);
    const state = reduceProgress(optional, l.events);
    expect(reasons(state)).toEqual([['ev-0002', 'not_required']]);
    expect(state).toMatchObject({ status: 'completed', acknowledgedAt: null });
  });

  it('completes the course on the acknowledgement once every lesson is read', () => {
    const ack = makeCourse({
      completion: { requireAllLessons: true, requireAcknowledgement: true },
      acknowledgement: statement,
      lessons: [content('l1', [blocks.paragraph('p1')]), content('l2', [blocks.paragraph('p2')])],
    });
    const l = learner();
    l.complete('l1');
    l.complete('l2');
    const waiting = reduceProgress(ack, l.events);
    expect(waiting).toMatchObject({ status: 'in_progress', blockedBy: null, percentComplete: 100 });
    // Nothing left to open: resume goes back to the lesson opened last, else the first one.
    expect(waiting.resume).toEqual({ lessonId: 'l1' });
    l.acknowledge(statement);
    const done = reduceProgress(ack, l.events);
    expect(done).toMatchObject({ status: 'completed', acknowledgedAt: l.events.at(-1)?.at });
    expect(done.completedAt).toBe(l.events.at(-1)?.at);
  });
});

describe('resume', () => {
  const free = makeCourse({
    lessons: [
      content('l1', [blocks.paragraph('p1')]),
      content('l2', [blocks.continue('c1'), blocks.continue('c2')]),
      content('l3', [blocks.paragraph('p3')]),
    ],
  });

  it('goes to the unfinished lesson opened last, at its first closed continue block', () => {
    const l = learner();
    l.open('l2');
    l.pass('l2', 'c1');
    l.open('l1');
    expect(reduceProgress(free, l.events).resume).toEqual({ lessonId: 'l1' });
    l.complete('l1');
    expect(reduceProgress(free, l.events).resume).toEqual({ lessonId: 'l2', blockId: 'c2' });
    l.pass('l2', 'c2');
    l.complete('l2');
    // Nothing opened is unfinished: the first open lesson not finished.
    expect(reduceProgress(free, l.events).resume).toEqual({ lessonId: 'l3' });
  });
});
