import type { ButtonBlock, Course } from '@carehub/learning';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderEditor, testCourse } from '../media/testing';
import { ButtonEditor } from './ButtonEditor';

// Fictional content only.
const block: ButtonBlock = {
  id: 'block_1',
  type: 'button',
  label: 'Read the policy',
  target: { kind: 'url', url: 'https://example.org/policy' },
};
const course = {
  ...testCourse,
  lessons: [
    { id: 'lesson_1', title: 'This lesson' },
    { id: 'lesson_2', title: 'Hand hygiene' },
  ],
} as unknown as Course;
const choice = (name: string) => screen.getByRole('button', { name });
const textbox = (name: string) => screen.getByRole('textbox', { name });

describe('ButtonEditor', () => {
  it('edits the text and the optional description', () => {
    const { latest } = renderEditor(ButtonEditor, block);
    fireEvent.change(textbox('Button text'), { target: { value: 'Open the policy' } });
    fireEvent.change(textbox('Description'), { target: { value: 'It takes 5 minutes.' } });
    expect(latest()).toMatchObject({
      label: 'Open the policy',
      description: 'It takes 5 minutes.',
    });
    fireEvent.change(textbox('Description'), { target: { value: '' } });
    expect(latest()).not.toHaveProperty('description');
  });

  it('keeps a web address only once it is a full one', () => {
    const { latest, changes } = renderEditor(ButtonEditor, block);
    fireEvent.change(textbox('Address'), { target: { value: 'example.org/rota' } });
    expect(textbox('Address')).toHaveAccessibleDescription(
      /Use a full https:\/\/ or mailto: address./,
    );
    expect(changes).toHaveLength(0);
    fireEvent.change(textbox('Address'), { target: { value: 'mailto:help@example.org' } });
    expect(latest().target).toEqual({ kind: 'url', url: 'mailto:help@example.org' });
  });

  it('goes to a Care Hub page from its address, keeping the old target until then', () => {
    const { latest } = renderEditor(ButtonEditor, block);
    fireEvent.click(choice('A Care Hub page'));
    expect(
      screen.getByText('Until you choose, the button still goes to its web address.'),
    ).toBeInTheDocument();
    fireEvent.change(textbox('Page address'), {
      target: { value: 'https://carehub.example.test/p/page_42?view=1' },
    });
    expect(latest().target).toEqual({ kind: 'page', pageId: 'page_42' });
    expect(screen.queryByText(/Until you choose/)).toBeNull();
  });

  it('offers the other lessons of the course, or says there are none', () => {
    renderEditor(ButtonEditor, block, course);
    fireEvent.click(choice('A lesson in this course'));
    expect(screen.getByRole('combobox', { name: 'Lesson' })).toBeInTheDocument();
  });

  it('says there are no other lessons to go to', () => {
    renderEditor(ButtonEditor, block);
    fireEvent.click(choice('A lesson in this course'));
    expect(screen.getByText('This course has no other lessons yet.')).toBeInTheDocument();
  });

  it('says when its lesson is gone', () => {
    renderEditor(
      ButtonEditor,
      { ...block, target: { kind: 'lesson', lessonId: 'lesson_9' } },
      course,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('no longer in this course');
  });
});
