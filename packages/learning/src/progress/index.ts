// progress module (B3): progress events, learner state, gating, completion and resume.
// See the B3 section of docs/learning/PLAN.md.
export { ProgressEventSchema } from './schema';
export type { NewProgressEvent, ProgressEvent, ProgressEventType } from './schema';
export { MAX_ACTIVE_SECONDS_PER_EVENT, reduceProgress } from './reduce';
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
