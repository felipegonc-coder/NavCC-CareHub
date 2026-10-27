// Test-only helpers for block views (the app never imports this file).
import {
  sampleStandardCourse,
  type Block,
  type ContentLesson,
  type Course,
  type Id,
  type LearnerCourseState,
} from '@carehub/learning';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { BlockView } from './registry';

/** A fictional course whose only lesson holds `blocks`. */
export function courseWith(blocks: Block[]): { course: Course; lesson: ContentLesson } {
  const lesson: ContentLesson = {
    id: 'lesson-test',
    kind: 'content',
    title: 'Answering the phone',
    blocks,
  };
  return { course: { ...sampleStandardCourse, lessons: [lesson] }, lesson };
}

/** A learner who has finished only `completedBlockIds` (in every lesson). */
export function learnerState(course: Course, completedBlockIds: Id[] = []): LearnerCourseState {
  return {
    courseId: course.id,
    status: 'in_progress',
    blockedBy: null,
    startedAt: null,
    completedAt: null,
    lastActivityAt: null,
    activeSeconds: 0,
    percentComplete: 0,
    lessons: course.lessons.map((lesson) => ({
      lessonId: lesson.id,
      status: 'in_progress',
      activeSeconds: 0,
      completedBlockIds,
      minimumMet: true,
      lastOpenedAt: null,
      completedAt: null,
    })),
    quizzes: [],
    knowledgeChecks: [],
    scenarios: [],
    acknowledgedAt: null,
    score: null,
    resume: null,
    rejected: [],
  };
}

/** Shows `block` through the registry as a learner sees it, in a lesson of `blocks` (default: it). */
export function renderBlock(block: Block, options: { blocks?: Block[]; completed?: Id[] } = {}) {
  const { course, lesson } = courseWith(options.blocks ?? [block]);
  const emit = vi.fn();
  const go = vi.fn();
  const view = render(
    <BlockView
      block={block}
      lesson={lesson}
      course={course}
      mode="learn"
      state={learnerState(course, options.completed)}
      emit={emit}
      go={go}
    />,
  );
  return { ...view, emit, go, course, lesson };
}
