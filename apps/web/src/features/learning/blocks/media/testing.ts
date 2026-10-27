// Test-only helpers for the media and interactive views (the app never imports this file).
import type { Block, ContentLesson, Id, Image } from '@carehub/learning';
import { vi } from 'vitest';
import type { BlockViewMode, BlockViewProps } from '../registry';
import { courseWith, learnerState } from '../test-utils';

export const picture = (alt: string, fileId = 'file_1'): Image => ({
  media: { kind: 'file', fileId },
  alt,
});

/** The course's second lesson, for buttons and links that open it. */
const secondLesson: ContentLesson = {
  id: 'lesson_2',
  kind: 'content',
  title: 'Hand hygiene',
  blocks: [],
};

/**
 * Props for `block` in lesson_1 of course_1 (lesson_2 is "Hand hygiene"), with `emit` and `go`
 * recorded. `completed` lists the blocks the learner finished before.
 */
export function viewProps<B extends Block>(
  block: B,
  options: { completed?: Id[]; mode?: BlockViewMode } = {},
): BlockViewProps<B> {
  const { course, lesson } = courseWith([block]);
  const first = { ...lesson, id: 'lesson_1' };
  const withLessons = { ...course, id: 'course_1', lessons: [first, secondLesson] };
  return {
    block,
    lesson: first,
    course: withLessons,
    mode: options.mode ?? 'learn',
    state: learnerState(withLessons, options.completed),
    emit: vi.fn(),
    go: vi.fn(),
  };
}
