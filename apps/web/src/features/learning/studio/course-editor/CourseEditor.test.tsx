import type { Course } from '@carehub/learning';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CourseEditorScreen } from '../index';
import { pageTitles, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only.

/** Opens "Hand hygiene" (two lessons) in the editor, at `search`. */
async function openCourse(search = '') {
  const client = testStudioClient();
  const draft = await client.createCourse({ type: 'standard', title: 'Hand hygiene' });
  const course: Course = {
    ...draft.course,
    lessons: [
      { id: 'lesson-why', kind: 'content', title: 'Why it matters', blocks: [] },
      { id: 'lesson-moments', kind: 'content', title: 'Five moments', blocks: [] },
    ],
  };
  await client.saveCourse(course.id, course, draft.revision);
  const view = renderStudio(`/learning/studio/courses/${course.id}${search}`, { client });
  await screen.findByRole('heading', { level: 1, name: 'Hand hygiene' });
  return { ...view, courseId: course.id };
}

const lessonNames = () =>
  within(screen.getByRole('navigation', { name: 'Outline' }))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
const savedTitle = (client: { getCourse(id: string): Promise<{ course: Course }> }, id: string) =>
  client.getCourse(id).then((draft) => draft.course.title);
const SAVE_WAIT = { timeout: 3000 };

describe('course editor', () => {
  it('opens the draft on its first lesson', async () => {
    await openCourse();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(pageTitles()).toContain('Care Hub · Hand hygiene');
    expect(screen.getByRole('link', { name: '1. Why it matters' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Lesson: Why it matters' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Lesson title' })).toHaveValue('Why it matters');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('opens the lesson in the address, and each lesson in the outline links to its place', async () => {
    const { courseId } = await openCourse('?lesson=lesson-moments');
    expect(screen.getByRole('region', { name: 'Lesson: Five moments' })).toBeInTheDocument();
    const first = screen.getByRole('link', { name: '1. Why it matters' });
    expect(first).toHaveAttribute('href', `/learning/studio/courses/${courseId}?lesson=lesson-why`);
    fireEvent.click(first);
    expect(screen.getByRole('region', { name: 'Lesson: Why it matters' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`${courseId}?lesson=lesson-why`);
  });

  it('renames the course and saves it a moment later', async () => {
    const { client, courseId } = await openCourse();
    const title = screen.getByRole('textbox', { name: 'Course title' });
    fireEvent.change(title, { target: { value: 'Hand hygiene at work' } });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hand hygiene at work');
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), SAVE_WAIT);
    expect(await savedTitle(client, courseId)).toBe('Hand hygiene at work');

    fireEvent.change(title, { target: { value: '  ' } });
    expect(screen.getByText('Add a title.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hand hygiene at work');
  });

  it('saves what is left when going back to the course list', async () => {
    const { client, courseId } = await openCourse();
    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene at work' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Studio' }));
    expect(await screen.findByRole('link', { name: 'Hand hygiene at work' })).toBeInTheDocument();
    expect(await savedTitle(client, courseId)).toBe('Hand hygiene at work');
  });

  it('adds, moves, copies and deletes lessons, and Undo brings one back', async () => {
    await openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Add lesson' }));
    expect(screen.getByRole('link', { name: '3. Lesson 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Lesson: Lesson 3' })).toHaveTextContent(
      "The lesson's blocks are edited here once the lesson canvas is ready.",
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Lesson 3 up' }));
    expect(lessonNames()).toEqual(['1. Why it matters', '2. Lesson 3', '3. Five moments']);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Lesson 3' }));
    expect(lessonNames()).toEqual([
      '1. Why it matters',
      '2. Lesson 3',
      '3. Copy of Lesson 3',
      '4. Five moments',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Lesson 3' }));
    expect(screen.getByText('Deleted “Lesson 3”.')).toBeInTheDocument();
    expect(lessonNames()).toEqual(['1. Why it matters', '2. Copy of Lesson 3', '3. Five moments']);
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Undo'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(lessonNames()).toHaveLength(4);
    expect(screen.queryByText('Deleted “Lesson 3”.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add quiz' }));
    expect(screen.getByRole('region', { name: 'Lesson: Quiz' })).toHaveTextContent(
      'Quiz questions and settings are edited here once the quiz editor is ready.',
    );
  });

  it('undoes and redoes with the buttons and the keyboard', async () => {
    await openCourse();
    const title = screen.getByRole('textbox', { name: 'Lesson title' });
    fireEvent.change(title, { target: { value: 'Why clean hands matter' } });
    expect(screen.getByRole('link', { name: '1. Why clean hands matter' })).toBeInTheDocument();

    fireEvent.keyDown(title, { key: 'z', ctrlKey: true });
    expect(title).toHaveValue('Why it matters');
    fireEvent.keyDown(title, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(title).toHaveValue('Why clean hands matter');
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(title).toHaveValue('Why it matters');
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(title).toHaveValue('Why clean hands matter');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(title).toHaveValue('Why it matters');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(title).toHaveValue('Why clean hands matter');
  });

  it('after someone else saves, loads their version when asked', async () => {
    const { client, courseId } = await openCourse();
    const theirs = await client.getCourse(courseId);
    await client.saveCourse(
      courseId,
      { ...theirs.course, title: 'Hand hygiene (theirs)' },
      theirs.revision,
    );

    const title = screen.getByRole('textbox', { name: 'Course title' });
    fireEvent.change(title, { target: { value: 'Hand hygiene (mine)' } });
    await waitFor(
      () =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Someone else saved this course after you opened it.',
        ),
      SAVE_WAIT,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load their version' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hand hygiene (theirs)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(title).toHaveValue('Hand hygiene (theirs)');

    fireEvent.change(title, { target: { value: 'Hand hygiene for everyone' } });
    await waitFor(
      async () => expect(await savedTitle(client, courseId)).toBe('Hand hygiene for everyone'),
      SAVE_WAIT,
    );
  });

  it('after someone else saves, keeps my version when asked', async () => {
    const { client, courseId } = await openCourse();
    const theirs = await client.getCourse(courseId);
    await client.saveCourse(
      courseId,
      { ...theirs.course, title: 'Hand hygiene (theirs)' },
      theirs.revision,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene (mine)' },
    });
    fireEvent.click(
      await waitFor(() => screen.getByRole('button', { name: 'Keep my version' }), SAVE_WAIT),
    );
    await waitFor(
      async () => expect(await savedTitle(client, courseId)).toBe('Hand hygiene (mine)'),
      SAVE_WAIT,
    );
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('says so when the course is gone', async () => {
    renderStudio('/learning/studio/courses/gone');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was deleted, or the link is wrong.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit course');
    expect(screen.getByRole('link', { name: 'Studio' })).toBeInTheDocument();
  });

  it('renders on its own, as the app routes do', async () => {
    render(<CourseEditorScreen />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was deleted, or the link is wrong.',
    );
  });
});
