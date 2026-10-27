import { describe, expect, it } from 'vitest';
import { CourseSchema, LIMITS, presetFor } from '../format/index';
import type { Course, Lesson } from '../format/index';
import { courseIds } from './ids';
import {
  deleteLesson,
  duplicateLesson,
  insertLesson,
  moveLesson,
  moveLessonBy,
  newLesson,
  renameLesson,
  updateLessonDetails,
  updateQuizSettings,
} from './lessons';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

const content = (id: string, title = `Lesson ${id}`): Lesson => ({
  id,
  kind: 'content',
  title,
  blocks: [{ id: `${id}-b1`, type: 'heading', level: 2, text: 'Hello' }],
});

// A small fictional course.
const make = (
  lessons: Lesson[] = [content('l1'), content('l2')],
  type: Course['type'] = 'standard',
): Course => ({
  formatVersion: 1,
  id: 'c1',
  title: 'Handling a billing question',
  type,
  settings: presetFor(type).settings,
  lessons,
});

const expectValid = (course: Course) => expect(CourseSchema.safeParse(course).success).toBe(true);
const titles = (course: Course) => course.lessons.map((l) => l.title);

describe('new lessons', () => {
  it('names lessons and quizzes by count and uses the preset quiz settings', () => {
    const course = make();
    expect(newLesson(course, 'content', counter())).toEqual({
      id: 'n1',
      kind: 'content',
      title: 'Lesson 3',
      blocks: [],
    });
    const first = newLesson(course, 'quiz', counter());
    expect(first).toMatchObject({
      kind: 'quiz',
      title: 'Quiz',
      settings: presetFor('standard').quiz,
      questions: [],
    });
    expect(newLesson(insertLesson(course, first), 'quiz').title).toBe('Quiz 2');
  });

  it('inserts at a position, replaces ids already in use and turns on the quiz rule', () => {
    const course = make();
    const quiz = { ...newLesson(course, 'quiz'), id: 'l1' };
    const next = insertLesson(course, quiz, 1, counter('x'));
    expect(next.lessons.map((l) => l.id)).toEqual(['l1', 'x1', 'l2']);
    expect(next.settings.completion.requireQuizPass).toBe(true);
    expectValid(next);
  });

  it('stops at 100 lessons', () => {
    const full = make(Array.from({ length: LIMITS.lessons }, (_, i) => content(`l${i}`)));
    expect(insertLesson(full, content('extra'))).toBe(full);
    expect(duplicateLesson(full, 'l0')).toBe(full);
  });
});

describe('lesson edits', () => {
  it('renames, ignoring blank titles', () => {
    const course = make();
    expect(titles(renameLesson(course, 'l1', 'Greet the caller'))).toEqual([
      'Greet the caller',
      'Lesson l2',
    ]);
    expect(renameLesson(course, 'l1', '  ')).toBe(course);
    expect(renameLesson(course, 'missing', 'Title')).toBe(course);
  });

  it('duplicates right after itself with fresh ids', () => {
    const next = duplicateLesson(make(), 'l1', counter());
    expect(titles(next)).toEqual(['Lesson l1', 'Copy of Lesson l1', 'Lesson l2']);
    expect(next.lessons[1]).toMatchObject({ id: 'n1', blocks: [{ id: 'n2' }] });
    expect(courseIds(next).size).toBe(6);
    expectValid(next);
  });

  it('deletes, and the quiz rule follows the last quiz', () => {
    const withQuiz = insertLesson(
      make(),
      newLesson(make(), 'quiz', () => 'q1'),
    );
    const next = deleteLesson(withQuiz, 'q1');
    expect(next.lessons.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(next.settings.completion.requireQuizPass).toBe(false);
    expect(deleteLesson(next, 'q1')).toBe(next);
  });

  it('moves by drag and by one place', () => {
    const course = make([content('a'), content('b'), content('c')]);
    expect(moveLesson(course, 'a', 2).lessons.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(moveLessonBy(course, 'c', -1).lessons.map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(moveLessonBy(course, 'a', -1)).toBe(course);
    expect(moveLesson(course, 'missing', 0)).toBe(course);
  });

  it('sets an icon, header picture and minimum time, or a quiz intro', () => {
    const header = {
      media: { kind: 'url' as const, url: 'https://images.example.org/desk.jpg' },
      alt: '',
      decorative: true,
    };
    let course = updateLessonDetails(make(), 'l1', {
      icon: ' 👋 ',
      headerImage: header,
      minimumSeconds: 99_999,
    });
    expect(course.lessons[0]).toMatchObject({
      icon: '👋',
      headerImage: header,
      minimumSeconds: LIMITS.minimumLessonSeconds,
    });
    expectValid(course);
    course = updateLessonDetails(course, 'l1', {
      icon: null,
      headerImage: null,
      minimumSeconds: null,
    });
    expect(course.lessons[0]).toEqual(content('l1'));
    const withQuiz = insertLesson(
      course,
      newLesson(course, 'quiz', () => 'q1'),
    );
    const intro = [{ runs: [{ text: 'Ten questions.' }] }];
    expect(updateLessonDetails(withQuiz, 'q1', { intro }).lessons[2]).toMatchObject({ intro });
    expect('intro' in (updateLessonDetails(withQuiz, 'q1', { intro: [] }).lessons[2] ?? {})).toBe(
      false,
    );
  });
});

describe('updateQuizSettings', () => {
  const course = insertLesson(
    make(),
    newLesson(make(), 'quiz', () => 'q1'),
  );
  const settings = (c: Course) => (c.lessons[2]?.kind === 'quiz' ? c.lessons[2].settings : null);

  it('keeps values in range', () => {
    const next = updateQuizSettings(course, 'q1', {
      passMark: 120,
      maxAttempts: 0,
      poolSize: 999,
      shuffleQuestions: true,
      mode: 'survey',
    });
    expect(settings(next)).toMatchObject({
      passMark: 100,
      maxAttempts: 1,
      poolSize: LIMITS.questions,
      shuffleQuestions: true,
      mode: 'survey',
    });
    expectValid(next);
    const off = updateQuizSettings(next, 'q1', { maxAttempts: null, poolSize: null, mode: null });
    expect(settings(off)?.maxAttempts).toBeNull();
    expect('poolSize' in (settings(off) ?? {})).toBe(false);
    expect('mode' in (settings(off) ?? {})).toBe(false);
  });

  it("returns the course itself when nothing changes or the lesson isn't a quiz", () => {
    expect(updateQuizSettings(course, 'q1', { passMark: settings(course)?.passMark ?? 0 })).toBe(
      course,
    );
    expect(updateQuizSettings(course, 'l1', { passMark: 50 })).toBe(course);
  });
});
