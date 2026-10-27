// progress module (B3): progress events, learner state, gating, completion and resume.
// See the B3 section of docs/learning/PLAN.md.
export { ProgressEventSchema } from './schema';
export type { NewProgressEvent, ProgressEvent, ProgressEventType } from './schema';
export {
  MAX_ACTIVE_SECONDS_PER_EVENT,
  MAX_SECONDS_AHEAD,
  checkProgressEvents,
  reduceProgress,
} from './reduce';
export type { CheckedProgressEvents } from './reduce';
export {
  LearnerCourseStateSchema,
  MAX_EVENTS_PER_LEARNER_COURSE,
  MAX_EVENTS_PER_REQUEST,
  ProgressEventsRequestSchema,
  ProgressEventsResponseSchema,
  ProgressNoteRequestSchema,
  QuizAttemptStartRequestSchema,
  progressEventsReply,
} from './api';
export type {
  ProgressEventsRequest,
  ProgressEventsResponse,
  ProgressNoteRequest,
  QuizAttemptStartRequest,
} from './api';
export { quizAttemptStart, quizSubmissionTime } from './attempts';
export type { QuizAttemptStart } from './attempts';
export { TOO_MANY_EVENTS_MESSAGE, progressIntake } from './intake';
export type { ProgressIntake } from './intake';
export { courseUpdateFor, withManualCompletion } from './updates';
export type {
  CourseUpdate,
  CourseUpdateNotice,
  CourseUpdateNotify,
  ManualCompletion,
} from './updates';
export { canCompleteLesson, nextLesson, visibleBlocks } from './gating';
export type { CanCompleteLesson, LessonBlocker } from './gating';
export type {
  KnowledgeCheckProgress,
  LearnerCourseState,
  LessonProgress,
  LessonProgressStatus,
  ProgressRejectReason,
  QuizAttemptRecord,
  QuizProgress,
  RejectedEvent,
  ResumePoint,
  ScenarioProgress,
} from './types';
