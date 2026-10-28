// Test helpers for the media and interactive editors (imported by tests only). Fictional data only.
import { createCourse } from '@carehub/learning';
import type { Block, Course, Image } from '@carehub/learning';
import { render } from '@testing-library/react';
import { useState } from 'react';
import type { JSX } from 'react';
import type { BlockEditorProps } from '../registry';

export const testCourse: Course = createCourse({
  type: 'standard',
  title: 'Hand hygiene',
  id: 'course_1',
});

export const picture = (alt: string, fileId = 'file_1'): Image => ({
  media: { kind: 'file', fileId },
  alt,
});

/** Renders an editor with its block kept in state; `latest()` is the block after the last change. */
export function renderEditor<B extends Block>(
  Editor: (props: BlockEditorProps<B>) => JSX.Element,
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
  return { container, changes, latest: (): B => changes.at(-1) ?? block };
}
