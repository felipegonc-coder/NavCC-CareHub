import { render, screen } from '@testing-library/react';
import { createCourse } from '@carehub/learning';
import type { Block } from '@carehub/learning';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockEditorFor, blockEditors } from './registry';

const course = createCourse({ type: 'standard', title: 'Hand hygiene' });
const paragraph: Block = { id: 'b1', type: 'paragraph', text: [{ runs: [{ text: 'Hello' }] }] };

afterEach(() => {
  delete blockEditors.paragraph;
});

describe('block editor registry', () => {
  it('shows a short note for a block type whose editor has not landed', () => {
    render(<BlockEditorFor block={paragraph} onChange={() => {}} course={course} lessonId="l1" />);
    expect(screen.getByText("This block can't be edited here yet.")).toBeInTheDocument();
  });

  it('hands the block, course and lesson to the editor for its type', () => {
    blockEditors.paragraph = ({ block, course: c, lessonId }) => (
      <p>{`${block.id} in ${lessonId} of ${c.title}`}</p>
    );
    render(<BlockEditorFor block={paragraph} onChange={() => {}} course={course} lessonId="l1" />);
    expect(screen.getByText('b1 in l1 of Hand hygiene')).toBeInTheDocument();
  });
});
