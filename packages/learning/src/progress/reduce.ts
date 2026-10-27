import type {
  Block,
  ContentLesson,
  Course,
  CourseStatus,
  Id,
  KnowledgeCheckBlock,
  Lesson,
  QuestionResponse,
  QuizLesson,
  ScenarioBlock,
} from '../format/index';
import { isResponseFor, scoreQuestion } from '../questions/index';
import {
  isPlanFor,
  quizStatus,
  scoreAttempt,
  type AttemptPlan,
  type QuizStatus,
} from '../quiz/index';
import { replayScenario, scenarioResult } from '../scenario/index';
import { firstClosedContinue, lessonBlocker, missingBeforeContinue } from './gating';
import { ProgressEventSchema, type ProgressEvent } from './schema';
import type {
  KnowledgeCheckProgress,
  LearnerCourseState,
  LessonProgress,
  QuizAttemptRecord,
  QuizProgress,
  RejectedEvent,
  ResumePoint,
  ScenarioProgress,
} from './types';

/** The most one time_active event counts for, and the slack on the wall-clock cap. */
export const MAX_ACTIVE_SECONDS_PER_EVENT = 60;

const FINISHED: ReadonlySet<CourseStatus> = new Set(['completed', 'passed', 'failed']);

type Rejection = Omit<RejectedEvent, 'eventId' | 'type' | 'at'>;
type LessonEvent = Exclude<ProgressEvent, { type: 'acknowledged' }>;
type Submission = Extract<ProgressEvent, { type: 'quiz_attempt_submitted' }>;
type BlockEvent = Extract<LessonEvent, { blockId: Id }>;
type ContentEvent = BlockEvent | Extract<LessonEvent, { type: 'lesson_completed' }>;
type Quiz = { attempts: QuizAttemptRecord[]; open: QuizProgress['openAttempt']; usedIds: Set<Id> };
type Work = {
  lesson: Lesson;
  quiz: Quiz | null;
  seconds: number;
  done: Set<Id>;
  touched: boolean;
  unlocked: boolean;
  lastOpenedAt: string | null;
  openedOrder: number;
  completedAt: string | null;
};

/** The block types each block event can be sent for. */
const BLOCK_TYPES: Record<BlockEvent['type'], ReadonlySet<Block['type']>> = {
  block_completed: new Set(['continue', 'process', 'flashcards', 'sorting']),
  knowledge_check_answered: new Set(['knowledge_check']),
  scenario_finished: new Set(['scenario']),
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const blockKey = (lessonId: Id, blockId: Id) => `${lessonId}/${blockId}`;
const isSurvey = (lesson: QuizLesson) => lesson.settings.mode === 'survey';

/** The lesson kind an event is for; null when it fits both. */
function kindFor(type: LessonEvent['type']): Lesson['kind'] | null {
  if (type === 'lesson_opened' || type === 'time_active') return null;
  return type === 'quiz_attempt_started' || type === 'quiz_attempt_submitted' ? 'quiz' : 'content';
}

function readString(raw: unknown, key: string): string | null {
  if (typeof raw !== 'object' || raw === null || !Object.hasOwn(raw, key)) return null;
  const value: unknown = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.slice(0, 100) : null;
}

/**
 * Replays one learner's events for one course version into their state. Deterministic: events are
 * sorted by time, then id, and a repeated id is dropped. Events that aren't valid or come too early
 * (locked lesson, hidden block, minimum time not spent, ...) change nothing and are listed in
 * `rejected` with a reason. Anti-tamper: a time_active event counts 1 to 60 s, total active time
 * never exceeds the span of the accepted events + 60 s, quiz plans must pass isPlanFor, and every
 * answer is scored again here.
 */
export function reduceProgress(course: Course, events: readonly unknown[]): LearnerCourseState {
  const rejected: RejectedEvent[] = [];
  const valid: { event: ProgressEvent; time: number; key: string }[] = [];
  for (const raw of events) {
    const parsed = ProgressEventSchema.safeParse(raw);
    const time = parsed.success ? Date.parse(parsed.data.at) : Number.NaN;
    if (parsed.success && Number.isFinite(time)) {
      valid.push({ event: parsed.data, time, key: JSON.stringify(parsed.data) });
    } else {
      rejected.push({
        eventId: readString(raw, 'id'),
        type: readString(raw, 'type'),
        at: readString(raw, 'at'),
        reason: 'invalid_event',
      });
    }
  }
  valid.sort(
    (a, b) => a.time - b.time || compareText(a.event.id, b.event.id) || compareText(a.key, b.key),
  );
  const run = new CourseRun(course);
  const seen = new Set<Id>();
  for (const { event, time } of valid) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const rejection = run.apply(event, time);
    const at = new Date(time).toISOString();
    if (rejection) rejected.push({ eventId: event.id, type: event.type, at, ...rejection });
  }
  return run.toState(rejected);
}

class CourseRun {
  private readonly course: Course;
  private readonly lessons = new Map<Id, Work>();
  private readonly checks = new Map<string, KnowledgeCheckProgress>();
  private readonly scenarios = new Map<string, ScenarioProgress>();
  private readonly jumps = new Set<Id>();
  private status: CourseStatus = 'not_started';
  private startedAt: string | null = null;
  private completedAt: string | null = null;
  private lastActivityAt: string | null = null;
  private acknowledgedAt: string | null = null;
  private firstTime: number | null = null;
  private activeSeconds = 0;
  private openings = 0;

  constructor(course: Course) {
    this.course = course;
    for (const lesson of course.lessons) {
      this.lessons.set(lesson.id, {
        lesson,
        quiz: lesson.kind === 'quiz' ? { attempts: [], open: null, usedIds: new Set() } : null,
        seconds: 0,
        done: new Set(),
        touched: false,
        unlocked: false,
        lastOpenedAt: null,
        openedOrder: 0,
        completedAt: null,
      });
    }
    this.updateLocks();
  }

  apply(event: ProgressEvent, time: number): Rejection | null {
    const at = new Date(time).toISOString();
    const rejection =
      event.type === 'acknowledged'
        ? this.acknowledge(event.statement, at)
        : this.applyToLesson(event, time, at);
    if (rejection) return rejection;
    this.firstTime ??= time;
    this.startedAt ??= at;
    this.lastActivityAt = at;
    this.updateLocks();
    this.updateStatus(at);
    return null;
  }

  private applyToLesson(event: LessonEvent, time: number, at: string): Rejection | null {
    const work = this.lessons.get(event.lessonId);
    if (!work) return { reason: 'unknown_lesson' };
    const { lesson, quiz } = work;
    const kind = kindFor(event.type);
    if (kind !== null && kind !== lesson.kind) return { reason: 'wrong_lesson_kind' };
    if (!work.unlocked) return { reason: 'locked' };
    let rejection: Rejection | null = null;
    if (event.type === 'lesson_opened') {
      work.lastOpenedAt = at;
      work.openedOrder = ++this.openings;
    } else if (event.type === 'time_active') {
      this.addTime(work, event.seconds, time);
    } else if (event.type === 'quiz_attempt_started') {
      if (lesson.kind === 'quiz' && quiz) rejection = this.start(lesson, quiz, event.plan, at);
    } else if (event.type === 'quiz_attempt_submitted') {
      if (lesson.kind === 'quiz' && quiz) rejection = this.submit(work, lesson, quiz, event, at);
    } else if (lesson.kind === 'content') {
      rejection = this.applyToContent(work, lesson, event, at);
    }
    if (!rejection) work.touched = true;
    return rejection;
  }

  private addTime(work: Work, seconds: number, time: number): void {
    const max = MAX_ACTIVE_SECONDS_PER_EVENT;
    const counted = Math.min(max, Math.max(1, Math.round(seconds)));
    const span = Math.floor((time - (this.firstTime ?? time)) / 1000);
    const added = Math.max(0, Math.min(counted, span + max - this.activeSeconds));
    work.seconds += added;
    this.activeSeconds += added;
  }

  private applyToContent(
    work: Work,
    lesson: ContentLesson,
    event: ContentEvent,
    at: string,
  ): Rejection | null {
    if (event.type === 'lesson_completed') {
      const blocker = lessonBlocker(lesson, false, work.seconds, work.done);
      if (blocker) return blocker;
      work.completedAt ??= at;
      return null;
    }
    const index = lesson.blocks.findIndex((candidate) => candidate.id === event.blockId);
    const block = lesson.blocks[index];
    if (!block) return { reason: 'unknown_block' };
    if (!BLOCK_TYPES[event.type].has(block.type)) return { reason: 'wrong_block_type' };
    const gate = firstClosedContinue(lesson, work.done);
    if (gate !== -1 && index > gate) return { reason: 'hidden' };
    let rejection: Rejection | null = null;
    if (event.type === 'knowledge_check_answered' && block.type === 'knowledge_check') {
      rejection = this.answerCheck(lesson.id, block, event.response, at);
    } else if (event.type === 'scenario_finished' && block.type === 'scenario') {
      rejection = this.finishScenario(lesson.id, block, event.choiceIds, at);
    } else if (block.type === 'continue' && block.requires === 'complete_above') {
      const missing = missingBeforeContinue(lesson, index, work.done);
      if (missing.length > 0) rejection = { reason: 'not_ready', blockIds: missing };
    }
    if (!rejection) work.done.add(block.id);
    return rejection;
  }

  private answerCheck(
    lessonId: Id,
    block: KnowledgeCheckBlock,
    response: QuestionResponse,
    at: string,
  ): Rejection | null {
    const key = blockKey(lessonId, block.id);
    const previous = this.checks.get(key);
    if (previous && !block.allowRetry) return { reason: 'already_answered' };
    if (!isResponseFor(block.question, response)) return { reason: 'bad_response' };
    const result = scoreQuestion(block.question, response);
    this.checks.set(key, {
      lessonId,
      blockId: block.id,
      answers: (previous?.answers ?? 0) + 1,
      firstCorrect: previous?.firstCorrect ?? result.correct,
      response,
      result,
      firstAnsweredAt: previous?.firstAnsweredAt ?? at,
      lastAnsweredAt: at,
    });
    return null;
  }

  private finishScenario(
    lessonId: Id,
    block: ScenarioBlock,
    choiceIds: Id[],
    at: string,
  ): Rejection | null {
    const replay = replayScenario(block, choiceIds);
    if (replay.invalidAt !== null || !replay.state.ended) return { reason: 'bad_choices' };
    const result = scenarioResult(block, { choiceIds });
    const key = blockKey(lessonId, block.id);
    const previous = this.scenarios.get(key);
    this.scenarios.set(key, {
      lessonId,
      blockId: block.id,
      runs: (previous?.runs ?? 0) + 1,
      bestScore: Math.max(previous?.bestScore ?? result.score, result.score),
      choiceIds: [...choiceIds],
      score: result.score,
      maxScore: result.maxScore,
      passed: result.passed,
      outcome: result.ending?.outcome ?? null,
      lessonJump: result.lessonJump,
      lastFinishedAt: at,
    });
    if (result.lessonJump !== null) this.jumps.add(result.lessonJump);
    return null;
  }

  private statusOf(lesson: QuizLesson, quiz: Quiz): QuizStatus {
    const results = quiz.attempts.map((attempt) => attempt.result);
    return quizStatus(lesson, results);
  }

  private start(lesson: QuizLesson, quiz: Quiz, plan: AttemptPlan, at: string): Rejection | null {
    if (this.statusOf(lesson, quiz).attemptsRemaining === 0) return { reason: 'no_attempts_left' };
    if (quiz.open) return { reason: 'attempt_open' };
    const reused = quiz.usedIds.has(plan.attemptId);
    if (reused || !isPlanFor(lesson, plan)) return { reason: 'invalid_plan' };
    quiz.open = { plan, startedAt: at };
    quiz.usedIds.add(plan.attemptId);
    return null;
  }

  private submit(
    work: Work,
    lesson: QuizLesson,
    quiz: Quiz,
    event: Submission,
    at: string,
  ): Rejection | null {
    const open = quiz.open;
    if (!open || open.plan.attemptId !== event.attemptId) return { reason: 'unknown_attempt' };
    const responses = Object.fromEntries(
      open.plan.questionIds.flatMap((id) => {
        const response = Object.hasOwn(event.responses, id) ? event.responses[id] : undefined;
        return response ? [[id, response] as const] : [];
      }),
    );
    const result = scoreAttempt(lesson, open.plan, responses);
    quiz.attempts.push({
      attemptId: open.plan.attemptId,
      ...open,
      submittedAt: at,
      responses,
      result,
    });
    quiz.open = null;
    const status = this.statusOf(lesson, quiz);
    // A quiz lesson is done once passed or out of attempts; a survey once sent.
    const done = isSurvey(lesson) || status.passed || status.attemptsRemaining === 0;
    if (done) work.completedAt ??= at;
    return null;
  }

  private acknowledge(statement: string, at: string): Rejection | null {
    const { acknowledgement, completion } = this.course.settings;
    if (!completion.requireAcknowledgement) return { reason: 'not_required' };
    const expected = acknowledgement?.statement ?? statement;
    if (statement !== expected) return { reason: 'bad_statement' };
    const unread = [...this.lessons.values()]
      .filter((work) => work.lesson.kind === 'content' && work.completedAt === null)
      .map((work) => work.lesson.id);
    if (unread.length > 0) return { reason: 'not_ready', lessonIds: unread };
    this.acknowledgedAt ??= at;
    return null;
  }

  /** Sequential courses: a lesson opens once every earlier lesson is completed or a finished
   * scenario jumped to it, and then stays open. Free order: every lesson is open. */
  private updateLocks(): void {
    const sequential = this.course.settings.lessonOrder === 'sequential';
    let earlierDone = true;
    for (const work of this.lessons.values()) {
      if (!sequential || earlierDone || this.jumps.has(work.lesson.id)) work.unlocked = true;
      earlierDone &&= work.completedAt !== null;
    }
  }

  /** Graded quiz statuses; surveys never count for requireQuizPass or the score. */
  private graded(): QuizStatus[] {
    return [...this.lessons.values()].flatMap(({ lesson, quiz }) =>
      lesson.kind === 'quiz' && quiz && !isSurvey(lesson) ? [this.statusOf(lesson, quiz)] : [],
    );
  }

  private requirements() {
    const { completion, minimumCourseSeconds } = this.course.settings;
    const graded = this.graded();
    const quizRequired = completion.requireQuizPass && graded.length > 0;
    // With no requirement switched on, every lesson is required.
    const allLessons =
      completion.requireAllLessons || (!quizRequired && !completion.requireAcknowledgement);
    const met =
      (!allLessons || [...this.lessons.values()].every((work) => work.completedAt !== null)) &&
      (!quizRequired || graded.every((status) => status.passed)) &&
      (!completion.requireAcknowledgement || this.acknowledgedAt !== null);
    return {
      met,
      quizRequired,
      failed: quizRequired && graded.some((s) => !s.passed && s.attemptsRemaining === 0),
      timeMet: this.activeSeconds >= (minimumCourseSeconds ?? 0),
    };
  }

  private updateStatus(at: string): void {
    if (FINISHED.has(this.status)) return;
    const { met, quizRequired, failed, timeMet } = this.requirements();
    if (failed) this.status = 'failed';
    else if (met && timeMet) this.status = quizRequired ? 'passed' : 'completed';
    else this.status = 'in_progress';
    if (FINISHED.has(this.status)) this.completedAt = at;
  }

  /** The unfinished open lesson opened last, else the first one. When none is left but the course
   * isn't finished (acknowledgement or course time missing): the lesson opened last, else the first
   * open one. */
  private resumePoint(): ResumePoint | null {
    const lessons = [...this.lessons.values()];
    const latest = (list: Work[]) =>
      list.reduce<Work | undefined>(
        (best, work) => (work.openedOrder > (best?.openedOrder ?? 0) ? work : best),
        undefined,
      );
    const unfinished = lessons.filter((work) => work.unlocked && work.completedAt === null);
    const pick =
      latest(unfinished) ??
      unfinished[0] ??
      latest(lessons) ??
      lessons.find((work) => work.unlocked);
    if (!pick) return null;
    const { lesson } = pick;
    const gate =
      lesson.kind === 'content' ? lesson.blocks[firstClosedContinue(lesson, pick.done)] : undefined;
    return gate ? { lessonId: lesson.id, blockId: gate.id } : { lessonId: lesson.id };
  }

  private inCourseOrder<T>(entries: ReadonlyMap<string, T>): T[] {
    return [...this.lessons.values()].flatMap(({ lesson }) =>
      lesson.kind === 'content'
        ? lesson.blocks.flatMap((block) => entries.get(blockKey(lesson.id, block.id)) ?? [])
        : [],
    );
  }

  private lessonProgress(work: Work): LessonProgress {
    const minimum = work.lesson.kind === 'content' ? (work.lesson.minimumSeconds ?? 0) : 0;
    const status = work.completedAt !== null ? 'completed' : !work.unlocked ? 'locked' : undefined;
    return {
      lessonId: work.lesson.id,
      status: status ?? (work.touched ? 'in_progress' : 'not_started'),
      activeSeconds: work.seconds,
      completedBlockIds: [...work.done],
      minimumMet: work.seconds >= minimum,
      lastOpenedAt: work.lastOpenedAt,
      completedAt: work.completedAt,
    };
  }

  private quizProgress(lesson: QuizLesson, quiz: Quiz): QuizProgress {
    const status = this.statusOf(lesson, quiz);
    return {
      lessonId: lesson.id,
      mode: isSurvey(lesson) ? 'survey' : 'graded',
      ...status,
      failed: !isSurvey(lesson) && !status.passed && status.attemptsRemaining === 0,
      attempts: quiz.attempts.map((attempt) => ({ ...attempt })),
      openAttempt: quiz.open ? { ...quiz.open } : null,
    };
  }

  toState(rejected: RejectedEvent[]): LearnerCourseState {
    const lessons = [...this.lessons.values()];
    const { met, timeMet } = this.requirements();
    const best = this.graded().flatMap((status) => status.bestPercent ?? []);
    const completed = lessons.filter((work) => work.completedAt !== null).length;
    return {
      courseId: this.course.id,
      status: this.status,
      blockedBy: this.status === 'in_progress' && met && !timeMet ? 'minimum_course_time' : null,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      lastActivityAt: this.lastActivityAt,
      activeSeconds: this.activeSeconds,
      percentComplete: lessons.length === 0 ? 0 : Math.floor((100 * completed) / lessons.length),
      lessons: lessons.map((work) => this.lessonProgress(work)),
      quizzes: lessons.flatMap(({ lesson, quiz }) =>
        lesson.kind === 'quiz' && quiz ? [this.quizProgress(lesson, quiz)] : [],
      ),
      knowledgeChecks: this.inCourseOrder(this.checks),
      scenarios: this.inCourseOrder(this.scenarios),
      acknowledgedAt: this.acknowledgedAt,
      score:
        best.length === 0 ? null : best.reduce((sum, percent) => sum + percent, 0) / best.length,
      resume: FINISHED.has(this.status) ? null : this.resumePoint(),
      rejected,
    };
  }
}
