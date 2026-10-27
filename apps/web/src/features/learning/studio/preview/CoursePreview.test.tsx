import { presetFor, richText } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pageTitles, renderEditor, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only.
const handHygiene = (blank: Course): Course => ({
  ...blank,
  lessons: [
    {
      id: 'lesson-why',
      kind: 'content',
      title: 'Why it matters',
      blocks: [
        { id: 'b1', type: 'heading', level: 1, text: 'Clean hands save lives' },
        {
          id: 'b2',
          type: 'paragraph',
          text: richText([
            { text: 'Use ' },
            { text: 'soap', marks: ['bold'] },
            { text: ' or rub.' },
          ]),
        },
        {
          id: 'b3',
          type: 'list',
          style: 'numbered',
          items: [
            { id: 'i1', text: richText('Wet your hands') },
            { id: 'i2', text: richText('Rub for 20 seconds') },
          ],
        },
        { id: 'b4', type: 'callout', tone: 'tip', text: richText('Keep your nails short.') },
        {
          id: 'b5',
          type: 'table',
          headerRow: true,
          rows: [
            ['Moment', 'When'],
            ['Before', 'Touching a customer'],
          ],
        },
        {
          id: 'b6',
          type: 'image',
          size: 'full',
          image: { media: { kind: 'url', url: 'https://example.com/hands.jpg' }, alt: 'Hands' },
        },
      ],
    },
    { id: 'lesson-steps', kind: 'content', title: 'Five moments', blocks: [] },
    {
      id: 'lesson-quiz',
      kind: 'quiz',
      title: 'Check yourself',
      settings: presetFor('standard').quiz,
      questions: [],
    },
  ],
});

const frame = () => screen.getByRole('region', { name: /^Preview at/ });

/** Saves `build(blank)` and opens its preview straight away. */
async function openPreview(build: (blank: Course) => Course = (blank) => blank) {
  const client = testStudioClient();
  const draft = await client.createCourse({ type: 'standard', title: 'Hand hygiene' });
  const course = build(draft.course);
  await client.saveCourse(course.id, course, draft.revision);
  renderStudio(`/learning/studio/courses/${course.id}/preview`, { client });
  await screen.findByRole('heading', { level: 1, name: 'Hand hygiene' });
  return course.id;
}

describe('course preview', () => {
  it('opens from the editor with the latest changes, read-only', async () => {
    await renderEditor(handHygiene);
    fireEvent.change(screen.getByRole('textbox', { name: 'Lesson title' }), {
      target: { value: 'Why clean hands matter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Why clean hands matter' }),
    ).toBeInTheDocument();
    expect(pageTitles()).toContain('Care Hub · Preview of Hand hygiene');
    const lesson = within(frame()).getByRole('article');
    expect(
      within(lesson).getByRole('heading', { level: 3, name: 'Clean hands save lives' }),
    ).toBeInTheDocument();
    expect(within(lesson).getByText('soap').tagName).toBe('STRONG');
    expect(
      within(lesson)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Wet your hands', 'Rub for 20 seconds']);
    expect(within(lesson).getByRole('note', { name: 'Tip' })).toHaveTextContent(
      'Keep your nails short.',
    );
    expect(within(lesson).getByRole('columnheader', { name: 'Moment' })).toBeInTheDocument();
    expect(within(lesson).getByRole('cell', { name: 'Touching a customer' })).toBeInTheDocument();
    expect(
      within(lesson).getByText(/^Image: this block can't be shown in the preview yet/),
    ).toBeInTheDocument();
    expect(within(lesson).queryByRole('textbox')).toBeNull();
  });

  it('goes through the lessons, focusing each one', async () => {
    await openPreview(handHygiene);
    const preview = screen.getByRole('main');
    expect(within(preview).getByRole('button', { name: 'Previous lesson' })).toBeDisabled();

    fireEvent.click(within(preview).getByRole('button', { name: 'Next lesson' }));
    const second = within(preview).getByRole('heading', { level: 2, name: 'Five moments' });
    await waitFor(() => expect(second).toHaveFocus());
    expect(within(preview).getByText('Lesson 2 of 3')).toBeInTheDocument();
    expect(within(preview).getByText('This lesson has no blocks yet.')).toBeInTheDocument();

    fireEvent.click(within(preview).getByRole('button', { name: '3. Check yourself' }));
    expect(within(preview).getByRole('button', { name: '3. Check yourself' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      within(preview).getByText(/^A quiz with 0 questions and a pass mark of 80%/),
    ).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: 'Next lesson' })).toBeDisabled();
  });

  it('switches between computer and phone width, and goes back to the editor', async () => {
    const client = testStudioClient();
    const draft = await client.createCourse({ type: 'standard', title: 'Hand hygiene' });
    renderStudio(`/learning/studio/courses/${draft.course.id}/preview`, { client });
    expect(
      await screen.findByText('This course has no lessons yet. Add one in the editor.'),
    ).toBeInTheDocument();
    const widths = screen.getByRole('group', { name: 'Width' });
    expect(within(widths).getByRole('button', { name: 'Computer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(widths).getByRole('button', { name: 'Phone' }));
    expect(frame()).toHaveAccessibleName('Preview at phone width');

    fireEvent.click(screen.getByRole('link', { name: 'Back to the editor' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/learning/studio/courses/${draft.course.id}`,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hand hygiene' }),
    ).toBeInTheDocument();
  });

  it('says so when the course is gone', async () => {
    renderStudio('/learning/studio/courses/missing/preview');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This course was deleted, or the link is wrong.',
    );
  });
});
