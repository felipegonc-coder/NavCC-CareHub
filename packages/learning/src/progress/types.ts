import type {
  CourseStatus,
  Id,
  IsoDateTime,
  QuestionResponse,
  ScenarioScene,
} from '../format/index';
import type { QuestionResult } from '../questions/index';
import type { AttemptPlan, AttemptResult, QuizStatus } from '../quiz/index';

export type LessonProgressStatus = 'locked' | 'not_started' | 'in_progress' | 'completed';

export type LessonProgress = {
  lessonId: Id;
  status: LessonProgressStatus;
  activeSeconds: number;
  /** Finished blocks (continue, process, flashcards, sorting, answered knowledge checks, finished
   * scenarios), in the order they were first finished. */
  completedBlockIds: Id[];
  /** The lesson has no minimum time, or the learner has spent it. */
  minimumMet: boolean;
  lastOpenedAt: IsoDateTime | null;
  /** Content: the accepted lesson_completed. Quiz: the submission that passed or used the last
   * attempt. Survey: the submission. */
  completedAt: IsoDateTime | null;
};

export type QuizAttemptRecord = {
  attemptId: Id;
  plan: AttemptPlan;
  startedAt: IsoDateTime;
  submittedAt: IsoDateTime;
  /** The answers to the plan's questions (anything else sent is dropped). */
  responses: Record<Id, QuestionResponse>;
  /** Scored again with scoreAttempt; scores sent by a browser are never used. */
  result: AttemptResult;
};

/** quizStatus for the lesson, plus its attempts. */
export type QuizProgress = QuizStatus & {
  lessonId: Id;
  mode: 'graded' | 'survey';
  /** Graded, never passed and no attempts left. */
  failed: boolean;
  attempts: QuizAttemptRecord[];
  /** A started attempt that isn't submitted yet; the player resumes it (only one can be open). */
  openAttempt: { plan: AttemptPlan; startedAt: IsoDateTime } | null;
};

export type KnowledgeCheckProgress = {
  lessonId: Id;
  blockId: Id;
  answers: number;
  firstCorrect: boolean;
  /** The latest answer and its result. */
  response: QuestionResponse;
  result: QuestionResult;
  firstAnsweredAt: IsoDateTime;
  lastAnsweredAt: IsoDateTime;
};

export type ScenarioProgress = {
  lessonId: Id;
  blockId: Id;
  runs: number;
  bestScore: number;
  /** The latest finished run. */
  choiceIds: Id[];
  score: number;
  maxScore: number;
  passed: boolean | null;
  outcome: NonNullable<ScenarioScene['ending']>['outcome'] | null;
  lessonJump: Id | null;
  lastFinishedAt: IsoDateTime;
};

/** The lesson to open and, in a content lesson, its first continue block not passed yet. */
export type ResumePoint = { lessonId: Id; blockId?: Id };

export type ProgressRejectReason =
  | 'invalid_event' // not a progress event (bad shape, unknown type, bad id or time)
  | 'unknown_lesson'
  | 'unknown_block'
  | 'wrong_lesson_kind' // e.g. a quiz event for a content lesson
  | 'wrong_block_type' // e.g. block_completed for a heading
  | 'locked' // sequential course, earlier lessons not completed
  | 'hidden' // the block is behind a continue block that isn't passed yet
  | 'not_ready' // complete_above continue too early (blockIds), acknowledgement too early (lessonIds)
  | 'minimum_time' // lesson completed before its minimum time (secondsLeft)
  | 'continue_blocks' // lesson completed with continue blocks not passed (blockIds)
  | 'bad_response' // a knowledge check answer that doesn't fit its question
  | 'already_answered' // knowledge check without allowRetry
  | 'bad_choices' // scenario choices that don't follow the scenes to an ending or a lesson jump
  | 'no_attempts_left'
  | 'attempt_open' // another attempt of this quiz is still open
  | 'invalid_plan' // fails isPlanFor, or its attemptId was used before
  | 'unknown_attempt' // no open attempt with this id
  | 'not_required' // acknowledgement on a course that doesn't ask for one
  | 'bad_statement'; // not the course's acknowledgement statement

export type RejectedEvent = {
  /** The event's id, type and time when they can be read, so the player can drop it from its queue. */
  eventId: string | null;
  type: string | null;
  at: string | null;
  reason: ProgressRejectReason;
  secondsLeft?: number;
  blockIds?: Id[];
  lessonIds?: Id[];
};

export type LearnerCourseState = {
  courseId: Id;
  status: CourseStatus;
  /** Everything else is done but the course's minimum time isn't spent yet (status stays in_progress). */
  blockedBy: 'minimum_course_time' | null;
  startedAt: IsoDateTime | null;
  /** When the last requirement was met, or when the last allowed attempt of a required quiz failed. */
  completedAt: IsoDateTime | null;
  lastActivityAt: IsoDateTime | null;
  activeSeconds: number;
  /** Completed lessons / lessons × 100, rounded down. */
  percentComplete: number;
  lessons: LessonProgress[];
  quizzes: QuizProgress[];
  knowledgeChecks: KnowledgeCheckProgress[];
  scenarios: ScenarioProgress[];
  acknowledgedAt: IsoDateTime | null;
  /** Mean of the best percents of the graded quizzes taken (surveys skipped); null before any. */
  score: number | null;
  /** Where to pick up; null once the course is finished. */
  resume: ResumePoint | null;
  rejected: RejectedEvent[];
};
