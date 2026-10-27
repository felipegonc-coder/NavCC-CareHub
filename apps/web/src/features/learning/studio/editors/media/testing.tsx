// Test helpers for the media editors (imported by tests only).
import type { Block, Course, Image } from '@carehub/learning';
import { render } from '@testing-library/react';
import { useState, type JSX } from 'react';
import type { EditorProps } from './editor-props';

export const testCourse = { id: 'course_1', lessons: [] } as unknown as Course;

export const picture = (alt: string, fileId = 'file_1'): Image => ({
  media: { kind: 'file', fileId },
  alt,
});

/** Renders an editor with its block kept in state; `latest()` is the block after the last change. */
export function renderEditor<B extends Block>(
  Editor: (props: EditorProps<B>) => JSX.Element,
  block: NoInfer<B>,
  course: Course = testCourse,
) {
  const changes: B[] = [];
  function Harness() {
    const [value, setValue] = useState(block);
    return (
      <Editor
        block={value}
        course={course}
        lessonId="lesson_1"
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  const { container } = render(<Harness />);
  return { container, changes, latest: (): B => changes[changes.length - 1] ?? block };
}
