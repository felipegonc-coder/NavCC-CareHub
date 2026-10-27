import { describe, expect, it } from 'vitest';
import { createCourse, deleteBlock, deleteLesson, renameLesson } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { courseEditorReducer, initCourseEditor } from './course-editor';
import type { CourseEditorAction, CourseEditorState } from './course-editor';

// Fictional data only.
const course: Course = {
  ...createCourse({ type: 'standard', title: 'Greeting callers', id: 'c1' }),
  lessons: [
    {
      id: 'l1',
      kind: 'content',
      title: 'Hello',
      blocks: [{ id: 'b1', type: 'divider', style: 'line' }],
    },
    {
      id: 'l2',
      kind: 'content',
      title: 'Tone',
      blocks: [{ id: 'b2', type: 'divider', style: 'line' }],
    },
    { id: 'l3', kind: 'content', title: 'Wrap-up', blocks: [] },
  ],
};
const run = (state: CourseEditorState, ...actions: CourseEditorAction[]) =>
  actions.reduce(courseEditorReducer, state);
const titles = (s: CourseEditorState) => s.history.present.lessons.map((l) => l.title);

describe('courseEditorReducer', () => {
  it('opens on the first lesson, or the one asked for when it exists', () => {
    expect(initCourseEditor(course)).toMatchObject({ lessonId: 'l1', blockId: null });
    expect(initCourseEditor(course, 'l2').lessonId).toBe('l2');
    expect(initCourseEditor(course, 'gone').lessonId).toBe('l1');
    expect(initCourseEditor({ ...course, lessons: [] }).lessonId).toBeNull();
  });

  it('records edits for undo and redo, merging typing in one field', () => {
    const start = initCourseEditor(course);
    const typed = run(
      start,
      { type: 'edit', edit: (c) => renameLesson(c, 'l1', 'Hel'), group: 'title:l1', at: 1000 },
      {
        type: 'edit',
        edit: (c) => renameLesson(c, 'l1', 'Hello there'),
        group: 'title:l1',
        at: 1500,
      },
      { type: 'edit', edit: (c) => renameLesson(c, 'l2', 'Voice'), group: 'title:l2', at: 1600 },
    );
    expect(titles(typed)).toEqual(['Hello there', 'Voice', 'Wrap-up']);
    expect(titles(run(typed, { type: 'undo' }))).toEqual(['Hello there', 'Tone', 'Wrap-up']);
    expect(titles(run(typed, { type: 'undo' }, { type: 'undo' }))).toEqual(titles(start));
    expect(titles(run(typed, { type: 'undo' }, { type: 'redo' }))).toEqual(titles(typed));
  });

  it('returns the same state for edits and undos that change nothing', () => {
    const start = initCourseEditor(course);
    expect(run(start, { type: 'edit', edit: (c) => c })).toBe(start);
    expect(run(start, { type: 'undo' }, { type: 'redo' })).toBe(start);
    expect(run(start, { type: 'select', lessonId: 'l1' })).toBe(start);
  });

  it('selects what an edit asks for, and keeps the selection on things that exist', () => {
    const onBlock = run(initCourseEditor(course), {
      type: 'select',
      lessonId: 'l2',
      blockId: 'b2',
    });
    expect(onBlock).toMatchObject({ lessonId: 'l2', blockId: 'b2' });
    expect(run(onBlock, { type: 'edit', edit: (c) => deleteBlock(c, 'b2') }).blockId).toBeNull();
    const removed = run(onBlock, { type: 'edit', edit: (c) => deleteLesson(c, 'l2') });
    expect(removed).toMatchObject({ lessonId: 'l3', blockId: null });
    const last = run(initCourseEditor(course, 'l3'), {
      type: 'edit',
      edit: (c) => deleteLesson(c, 'l3'),
    });
    expect(last.lessonId).toBe('l2');
    expect(run(removed, { type: 'undo' }).lessonId).toBe('l3');
    const moved = run(onBlock, {
      type: 'edit',
      edit: (c) => renameLesson(c, 'l1', 'Hi'),
      select: { lessonId: 'l1' },
    });
    expect(moved).toMatchObject({ lessonId: 'l1', blockId: null });
    expect(run(onBlock, { type: 'select', lessonId: 'l1', blockId: 'b2' }).blockId).toBeNull();
  });

  it('loads a newer draft without undo history', () => {
    const edited = run(initCourseEditor(course, 'l3'), {
      type: 'edit',
      edit: (c) => renameLesson(c, 'l3', 'Bye'),
    });
    const loaded = run(edited, {
      type: 'load',
      course: { ...course, lessons: course.lessons.slice(0, 2) },
    });
    expect(loaded.history.past).toEqual([]);
    expect(loaded.lessonId).toBe('l2');
  });
});
