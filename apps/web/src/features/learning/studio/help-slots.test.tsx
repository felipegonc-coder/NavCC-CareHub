import { createCourse, renameLesson } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { studioHelp } from './help-slots';
import { renderEditor, renderStudio, testStudioClient } from './test-utils';

// Fictional data only.
const withLesson = (blank: Course): Course => ({
  ...blank,
  lessons: [{ id: 'lesson-why', kind: 'content', title: 'Why it matters', blocks: [] }],
});

afterEach(() => {
  delete studioHelp.lesson;
  delete studioHelp.newCourse;
});

describe('places for Learning help', () => {
  it('shows nothing while help leaves them empty', async () => {
    await renderEditor(withLesson);
    expect(screen.queryByRole('button', { name: /help/i })).toBeNull();
  });

  it("gives the lesson editor's help the draft, flush and an undoable edit", async () => {
    const seen: { saved: boolean; title: string }[] = [];
    studioHelp.lesson = ({ course, lessonId, edit, flush }) => (
      <button
        type="button"
        onClick={async () => {
          seen.push({ saved: await flush(), title: course.title });
          edit((c) => renameLesson(c, lessonId, 'Drafted by help'));
        }}
      >
        Help with this lesson
      </button>
    );
    const client = testStudioClient();
    const { courseId } = await renderEditor(withLesson, client);
    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene basics' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Help with this lesson' }));

    await waitFor(() => expect(seen).toEqual([{ saved: true, title: 'Hand hygiene basics' }]));
    expect((await client.getCourse(courseId)).course.title).toBe('Hand hygiene basics');
    expect(screen.getByRole('textbox', { name: 'Lesson title' })).toHaveValue('Drafted by help');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('textbox', { name: 'Lesson title' })).toHaveValue('Why it matters');
  });

  it('saves a course New course help drafted, and refuses one that is not valid', async () => {
    const client = testStudioClient();
    const drafted: Course = {
      ...createCourse({ type: 'standard', title: 'Glove use', id: 'drafted' }),
      lessons: [{ id: 'lesson-when', kind: 'content', title: 'When to wear gloves', blocks: [] }],
    };
    const broken = {
      ...drafted,
      lessons: [{ id: 'lesson-x', kind: 'content' }],
    } as unknown as Course;
    const saved: boolean[] = [];
    studioHelp.newCourse = ({ onDraft }) => (
      <>
        <button type="button" onClick={async () => saved.push(await onDraft(broken))}>
          Draft a broken course
        </button>
        <button type="button" onClick={async () => saved.push(await onDraft(drafted))}>
          Draft a course with help
        </button>
      </>
    );
    renderStudio('/learning/studio', { client });
    fireEvent.click(await screen.findByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Draft a broken course' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The drafted course couldn't be saved. Try again.",
    );
    expect(saved).toEqual([false]);
    expect(await client.listCourses()).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Draft a course with help' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Glove use' })).toBeInTheDocument();
    expect(saved).toEqual([false, true]);
    const [summary] = await client.listCourses();
    const { course } = await client.getCourse(summary?.id ?? '');
    expect(course.lessons.map((lesson) => lesson.title)).toEqual(['When to wear gloves']);
  });
});
