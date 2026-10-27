import { describe, expect, it } from 'vitest';
import { CourseSchema, type Course } from '../format/index';
import { learnerCourse } from '../quiz/index';
import { courseOutline, previousLessonId, type OutlineProgress } from './outline';
import { helpDesk } from './test-course';

const freeOrder: Course = { ...helpDesk, settings: { ...helpDesk.settings, lessonOrder: 'free' } };

describe('the test course', () => {
  it('is a valid course', () => {
    expect(CourseSchema.safeParse(helpDesk).success).toBe(true);
  });
});

describe('courseOutline', () => {
  const progress: OutlineProgress = {
    lessons: [
      { lessonId: 'l-greet', status: 'completed' },
      { lessonId: 'l-refunds', status: 'in_progress' },
      { lessonId: 'l-esc', status: 'locked' },
      { lessonId: 'l-quiz', status: 'locked' },
    ],
  };

  it('lists every lesson in order with its state, link and icon', () => {
    const outline = courseOutline(helpDesk, progress, 'l-refunds');
    expect(outline.total).toBe(4);
    expect(outline.completed).toBe(1);
    expect(outline.rows[0]).toEqual({
      lessonId: 'l-greet',
      number: 1,
      title: 'Greeting customers',
      icon: '👋',
      kind: 'content',
      status: 'completed',
      statusText: 'Completed',
      current: false,
      href: '/learning/courses/c-help-desk/lessons/l-greet',
    });
    expect(outline.rows.map((row) => [row.status, row.statusText, row.current])).toEqual([
      ['completed', 'Completed', false],
      ['in_progress', 'In progress', true],
      ['locked', 'Locked', false],
      ['locked', 'Locked', false],
    ]);
    expect(outline.rows[3]).toMatchObject({ kind: 'quiz', number: 4 });
    expect(outline.rows[3]?.icon).toBeUndefined();
  });

  it('reads the learner view, whose quiz lessons have no questions, like the full course', () => {
    expect(courseOutline(learnerCourse(helpDesk), progress, 'l-refunds')).toEqual(
      courseOutline(helpDesk, progress, 'l-refunds'),
    );
    expect(previousLessonId(learnerCourse(helpDesk), 'l-quiz')).toBe('l-esc');
  });

  it("explains a locked lesson by naming the first earlier lesson that isn't finished", () => {
    const outline = courseOutline(helpDesk, progress);
    expect(outline.rows[2]?.lockedReason).toBe('Finish "Résumé of the refund policy" first.');
    expect(outline.rows[3]?.lockedReason).toBe('Finish "Résumé of the refund policy" first.');
    expect(outline.rows[0]?.lockedReason).toBeUndefined();
    expect(outline.rows[1]?.lockedReason).toBeUndefined();
  });

  it("works out lessons that progress doesn't mention from the lesson order", () => {
    const fresh = courseOutline(helpDesk, null);
    expect(fresh.rows.map((row) => row.status)).toEqual([
      'not_started',
      'locked',
      'locked',
      'locked',
    ]);
    expect(fresh.rows[1]?.lockedReason).toBe('Finish "Greeting customers" first.');
    expect(fresh.completed).toBe(0);

    const partial = courseOutline(helpDesk, {
      lessons: [{ lessonId: 'l-greet', status: 'completed' }],
    });
    expect(partial.rows.map((row) => row.status)).toEqual([
      'completed',
      'not_started',
      'locked',
      'locked',
    ]);
    expect(partial.rows[2]?.lockedReason).toBe('Finish "Résumé of the refund policy" first.');
  });

  it('locks nothing by itself when lessons are free, and gives a plain reason if progress locks one', () => {
    expect(courseOutline(freeOrder).rows.every((row) => row.status === 'not_started')).toBe(true);
    const outline = courseOutline(freeOrder, {
      lessons: [{ lessonId: 'l-quiz', status: 'locked' }],
    });
    expect(outline.rows[3]?.lockedReason).toBe("This lesson isn't open yet.");
  });

  it('follows the progress when it opens a lesson out of order', () => {
    const outline = courseOutline(helpDesk, {
      lessons: [{ lessonId: 'l-esc', status: 'in_progress' }],
    });
    expect(outline.rows.map((row) => row.status)).toEqual([
      'not_started',
      'locked',
      'in_progress',
      'locked',
    ]);
    expect(outline.rows[3]?.lockedReason).toBe('Finish "Greeting customers" first.');
  });
});

describe('previousLessonId', () => {
  it('returns the lesson before, or null at the start and for unknown lessons', () => {
    expect(previousLessonId(helpDesk, 'l-refunds')).toBe('l-greet');
    expect(previousLessonId(helpDesk, 'l-quiz')).toBe('l-esc');
    expect(previousLessonId(helpDesk, 'l-greet')).toBeNull();
    expect(previousLessonId(helpDesk, 'l-missing')).toBeNull();
  });
});
