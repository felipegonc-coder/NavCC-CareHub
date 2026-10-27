import type { Block, Course, Image } from '@carehub/learning';
import { vi } from 'vitest';
import type { ViewProps } from './view-props';

/** A course with one lesson, for links. */
export const testCourse = {
  id: 'course_1',
  lessons: [{ id: 'lesson_2', title: 'Hand hygiene' }],
} as unknown as Pick<Course, 'id' | 'lessons'>;

export const picture = (alt: string, fileId = 'file_1'): Image => ({
  media: { kind: 'file', fileId },
  alt,
});

/** Props for a block view, with `emit` and `go` recorded. */
export function viewProps<B extends Block>(
  block: B,
  overrides: Partial<ViewProps<B>> = {},
): ViewProps<B> {
  return {
    block,
    lesson: { id: 'lesson_1' },
    course: testCourse,
    mode: 'learn',
    state: { lessons: [] },
    emit: vi.fn(),
    go: vi.fn(),
    ...overrides,
  };
}
