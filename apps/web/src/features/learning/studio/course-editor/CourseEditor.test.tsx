import type { Block, Course } from '@carehub/learning';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockEditors } from '../editors/registry';
import { CourseEditorScreen } from '../index';
import { pageTitles, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only.
const paragraph = (id: string, text: string): Block => ({
  id,
  type: 'paragraph',
  text: [{ runs: [{ text }] }],
});

/** Opens "Hand hygiene" (two lessons, the first with two paragraphs) in the editor, at `search`. */
async function openCourse(search = '') {
  const client = testStudioClient();
  const draft = await client.createCourse({ type: 'standard', title: 'Hand hygiene' });
  const course: Course = {
    ...draft.course,
    lessons: [
      {
        id: 'lesson-why',
        kind: 'content',
        title: 'Why it matters',
        blocks: [
          paragraph('block-1', 'Clean hands save lives.'),
          paragraph('block-2', 'Use soap or hand rub.'),
        ],
      },
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
const blockTexts = () => screen.getAllByTestId('paragraph').map((text) => text.textContent);
const savedTitle = (client: { getCourse(id: string): Promise<{ course: Course }> }, id: string) =>
  client.getCourse(id).then((draft) => draft.course.title);
const SAVE_WAIT = { timeout: 3000 };
/** The quiz editor asks the API for the question banks; these tests leave that list loading. */
const banksPending = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));

// Show each paragraph's text plainly, so these tests read it without the paragraph editor.
const realParagraphEditor = blockEditors.paragraph;
beforeEach(() => {
  blockEditors.paragraph = ({ block }) => (
    <p data-testid="paragraph">
      {block.text.map((p) => p.runs.map((run) => run.text).join('')).join('\n')}
    </p>
  );
});
afterEach(() => {
  if (realParagraphEditor) blockEditors.paragraph = realParagraphEditor;
  else delete blockEditors.paragraph;
  vi.restoreAllMocks();
});

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
    expect(screen.getByRole('region', { name: 'Block 2, Paragraph' })).toBeInTheDocument();
    expect(blockTexts()).toEqual(['Clean hands save lives.', 'Use soap or hand rub.']);
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
    banksPending();
    await openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Add lesson' }));
    expect(screen.getByRole('link', { name: '3. Lesson 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Lesson: Lesson 3' })).toHaveTextContent(
      'This lesson is empty. Add a block to start.',
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
    const quiz = screen.getByRole('region', { name: 'Lesson: Quiz' });
    expect(within(quiz).getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
  });

  it("sets a lesson's minimum time in seconds; an empty box removes it", async () => {
    banksPending();
    const { client, courseId } = await openCourse();
    const firstLesson = async () => (await client.getCourse(courseId)).course.lessons[0];
    const minimum = screen.getByRole('spinbutton', { name: 'Minimum time, in seconds' });
    fireEvent.change(minimum, { target: { value: '60' } });
    await waitFor(
      async () => expect(await firstLesson()).toMatchObject({ minimumSeconds: 60 }),
      SAVE_WAIT,
    );
    fireEvent.change(minimum, { target: { value: '4000' } });
    expect(screen.getByText('Use a whole number from 1 to 3600.')).toBeInTheDocument();
    fireEvent.change(minimum, { target: { value: '' } });
    await waitFor(
      async () => expect(await firstLesson()).not.toHaveProperty('minimumSeconds'),
      SAVE_WAIT,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add quiz' }));
    expect(screen.queryByRole('spinbutton', { name: 'Minimum time, in seconds' })).toBeNull();
  });

  it('edits a quiz in the quiz editor and saves it, and Undo takes the change back', async () => {
    banksPending();
    const { client, courseId } = await openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Add quiz' }));
    const quiz = screen.getByRole('region', { name: 'Lesson: Quiz' });
    fireEvent.click(within(quiz).getByRole('button', { name: 'True or false' }));
    const passMark = () => within(quiz).getByRole('spinbutton', { name: 'Pass mark (%)' });
    fireEvent.change(passMark(), { target: { value: '90' } });
    expect(within(quiz).getByRole('heading', { level: 3, name: 'Question 1' })).toBeInTheDocument();
    await waitFor(
      async () =>
        expect((await client.getCourse(courseId)).course.lessons[2]).toMatchObject({
          kind: 'quiz',
          settings: { passMark: 90 },
          questions: [{ type: 'true_false' }],
        }),
      SAVE_WAIT,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(passMark()).not.toHaveValue(90);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(passMark()).toHaveValue(90);
  });

  it('adds blocks from the menu, asking for an address when a block needs one', async () => {
    const { client, courseId } = await openCourse();
    fireEvent.click(screen.getByRole('link', { name: '2. Five moments' }));
    const lesson = screen.getByRole('region', { name: 'Lesson: Five moments' });
    fireEvent.click(within(lesson).getByRole('button', { name: 'Add block' }));
    let menu = screen.getByRole('region', { name: 'Add a block' });
    const search = within(menu).getByRole('searchbox', { name: 'Search blocks' });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: 'paragraph' } });
    expect(within(menu).getByRole('menu', { name: 'Add a block' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Paragraph' }));

    const added = screen.getByRole('region', { name: 'Block 1, Paragraph' });
    await waitFor(() => expect(added).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Add a block' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a block below block 1' }));
    menu = screen.getByRole('region', { name: 'Add a block' });
    const file = within(menu).getByRole('menuitem', { name: 'File download' });
    expect(file).toHaveAttribute('aria-disabled', 'true');
    expect(file).toHaveAccessibleDescription('Available once file uploads are ready.');
    fireEvent.click(file);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Image' }));
    const address = within(menu).getByRole('textbox', { name: 'Picture address' });
    await waitFor(() => expect(address).toHaveFocus());
    fireEvent.change(address, { target: { value: 'http://example.org/hands.png' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Add block' }));
    expect(within(menu).getByText('Use a full https:// address.')).toBeInTheDocument();
    fireEvent.change(address, { target: { value: 'https://example.org/hands.png' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Add block' }));
    expect(screen.getByRole('region', { name: 'Block 2, Image' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search blocks' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Add a block' })).toBeNull();

    await waitFor(async () => {
      const { course } = await client.getCourse(courseId);
      expect(
        course.lessons[1]?.kind === 'content' && course.lessons[1].blocks.map((b) => b.type),
      ).toEqual(['paragraph', 'image']);
    }, SAVE_WAIT);
  });

  it('moves through the add-block menu with the keyboard', async () => {
    await openCourse();
    fireEvent.click(screen.getByRole('link', { name: '2. Five moments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    const search = screen.getByRole('searchbox', { name: 'Search blocks' });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: 'quote' } });
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('tabindex'))).toEqual(
      items.map((_, index) => (index === 0 ? '0' : '-1')),
    );
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowUp' });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: 'heading' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Block 1, Heading' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves, copies and deletes blocks, and Undo brings one back', async () => {
    await openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Move block 1 down' }));
    expect(blockTexts()).toEqual(['Use soap or hand rub.', 'Clean hands save lives.']);
    expect(screen.getByRole('button', { name: 'Move block 1 up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate block 2' }));
    expect(blockTexts()).toEqual([
      'Use soap or hand rub.',
      'Clean hands save lives.',
      'Clean hands save lives.',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete block 1' }));
    expect(screen.getByText('Deleted block 1 (Paragraph).')).toBeInTheDocument();
    expect(blockTexts()).toEqual(['Clean hands save lives.', 'Clean hands save lives.']);
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Undo'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(blockTexts()).toEqual([
      'Use soap or hand rub.',
      'Clean hands save lives.',
      'Clean hands save lives.',
    ]);
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
