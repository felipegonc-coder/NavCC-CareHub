import { presetFor, richText } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pageTitles, renderEditor, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only. The lessons go in order, so the preview has to open them all anyway.
const handHygiene = (blank: Course): Course => ({
  ...blank,
  settings: { ...blank.settings, lessonOrder: 'sequential' },
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
            { text: ' or rub, at ' },
            {
              text: 'five moments',
              link: { kind: 'lesson', lessonId: 'lesson-steps', blockId: 'b-after' },
            },
            { text: '.' },
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
      ],
    },
    {
      id: 'lesson-steps',
      kind: 'content',
      title: 'Five moments',
      blocks: [
        { id: 'b-before', type: 'paragraph', text: richText('Before you touch a customer.') },
        { id: 'b-go', type: 'continue', label: 'Show the next moment', requires: 'click' },
        { id: 'b-after', type: 'paragraph', text: richText('After you touch their things.') },
      ],
    },
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
  await screen.findByText(/^Preview of the draft/);
  return { client, courseId: course.id };
}

describe('course preview', () => {
  it('opens from the editor with the latest changes, through the player block views', async () => {
    await renderEditor(handHygiene);
    fireEvent.change(screen.getByRole('textbox', { name: 'Lesson title' }), {
      target: { value: 'Why clean hands matter' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Preview' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Why clean hands matter' }),
    ).toBeInTheDocument();
    expect(pageTitles()).toContain('Care Hub · Preview of Hand hygiene');
    const lesson = within(frame()).getByRole('article');
    expect(
      within(lesson).getByRole('heading', { level: 2, name: 'Clean hands save lives' }),
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
    expect(within(lesson).queryByRole('textbox')).toBeNull();
  });

  it('opens every lesson, and continue blocks work without saving anything', async () => {
    const { client, courseId } = await openPreview(handHygiene);
    const before = await client.getCourse(courseId);
    const preview = within(frame());
    fireEvent.click(preview.getByRole('button', { name: '2. Five moments' }));
    const title = preview.getByRole('heading', { level: 1, name: 'Five moments' });
    await waitFor(() => expect(title).toHaveFocus());
    expect(preview.getByText('Before you touch a customer.')).toBeInTheDocument();
    expect(preview.queryByText('After you touch their things.')).toBeNull();

    fireEvent.click(preview.getByRole('button', { name: 'Show the next moment' }));
    const after = await preview.findByText('After you touch their things.');
    await waitFor(() => expect(after.closest('[tabindex="-1"]')).toHaveFocus());
    expect(preview.queryByRole('button', { name: 'Show the next moment' })).toBeNull();
    expect(await client.getCourse(courseId)).toEqual(before);

    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(preview.queryByText('After you touch their things.')).toBeNull();
    expect(preview.getByRole('button', { name: 'Show the next moment' })).toBeInTheDocument();
  });

  it('follows a link to another lesson inside the preview', async () => {
    await openPreview(handHygiene);
    const preview = within(frame());
    fireEvent.click(preview.getByRole('link', { name: 'five moments' }));
    // The block the link points to is behind a continue block, so the lesson title gets focus.
    const title = preview.getByRole('heading', { level: 1, name: 'Five moments' });
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByTestId('location')).toHaveTextContent(/\/preview$/);
  });

  it('goes through the lessons with Previous and Next', async () => {
    await openPreview(handHygiene);
    const preview = within(frame());
    expect(preview.getByRole('button', { name: 'Previous lesson' })).toBeDisabled();

    fireEvent.click(preview.getByRole('button', { name: 'Next lesson' }));
    await waitFor(() =>
      expect(preview.getByRole('heading', { level: 1, name: 'Five moments' })).toHaveFocus(),
    );
    expect(preview.getByText('Lesson 2 of 3')).toBeInTheDocument();

    fireEvent.click(preview.getByRole('button', { name: 'Next lesson' }));
    expect(preview.getByRole('button', { name: '3. Check yourself' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      preview.getByText("This is a quiz. Quizzes can't be tried in the preview yet."),
    ).toBeInTheDocument();
    expect(preview.getByRole('button', { name: 'Next lesson' })).toBeDisabled();
    fireEvent.click(preview.getByRole('button', { name: 'Previous lesson' }));
    expect(preview.getByText('Lesson 2 of 3')).toBeInTheDocument();
  });

  it('switches between computer and phone width, and goes back to the editor', async () => {
    const { courseId } = await openPreview();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Nothing to preview yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This course has no lessons yet. Add one in the editor.'),
    ).toBeInTheDocument();
    const widths = screen.getByRole('group', { name: 'Width' });
    expect(within(widths).getByRole('radio', { name: 'Computer' })).toBeChecked();
    fireEvent.click(within(widths).getByRole('radio', { name: 'Phone' }));
    expect(within(widths).getByRole('radio', { name: 'Phone' })).toBeChecked();
    expect(frame()).toHaveAccessibleName('Preview at phone width');

    fireEvent.click(screen.getByRole('link', { name: 'Back to the editor' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/learning/studio/courses/${courseId}`,
    );
    expect(await screen.findByRole('textbox', { name: 'Course title' })).toBeInTheDocument();
  });

  it('says so when the course is gone', async () => {
    renderStudio('/learning/studio/courses/missing/preview');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was deleted, or the link is wrong.',
    );
  });
});
