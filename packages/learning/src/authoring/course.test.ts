import { describe, expect, it } from 'vitest';
import { CourseSchema, LIMITS, presetFor } from '../format/index';
import type { Course, Lesson } from '../format/index';
import {
  changeCourseType,
  duplicateCourse,
  renameCourse,
  setCourseCover,
  setCourseDescription,
  setCourseSummary,
  setCourseTopics,
  setEstimatedMinutes,
  syncQuizRule,
  updateCourseSettings,
} from './course';
import { courseIds } from './ids';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

const quiz = (id: string): Lesson => ({
  id,
  kind: 'quiz',
  title: 'Check',
  settings: { ...presetFor('standard').quiz, poolSize: 2 },
  questions: [],
});

// A small fictional course.
const make = (lessons: Lesson[] = [], type: Course['type'] = 'standard'): Course => ({
  formatVersion: 1,
  id: 'c1',
  title: 'Greeting new members',
  type,
  settings: {
    ...presetFor(type).settings,
    catalog: { listed: false },
    labels: { start: 'Begin' },
    minimumCourseSeconds: 300,
  },
  lessons,
});

const expectValid = (course: Course) => expect(CourseSchema.safeParse(course).success).toBe(true);

describe('course details', () => {
  it('renames, ignoring blank titles and cutting long ones', () => {
    const course = make();
    expect(renameCourse(course, '   ')).toBe(course);
    expect(renameCourse(course, course.title)).toBe(course);
    expect(renameCourse(course, 'x'.repeat(300)).title).toHaveLength(LIMITS.title);
    expectValid(renameCourse(course, 'Welcome calls'));
  });

  it('sets and removes the summary, description, cover and estimated time', () => {
    let course = setCourseSummary(make(), 'How we greet people.');
    expect(course.summary).toBe('How we greet people.');
    expect('summary' in setCourseSummary(course, '  ')).toBe(false);
    course = setCourseDescription(course, [{ runs: [{ text: 'Start here.' }] }]);
    expect(course.description).toHaveLength(1);
    expect('description' in setCourseDescription(course, [{ runs: [{ text: ' ' }] }])).toBe(false);
    const cover = { media: { kind: 'file' as const, fileId: 'file-1' }, alt: 'A friendly desk' };
    course = setCourseCover(course, cover);
    expect(course.cover).toEqual(cover);
    expect('cover' in setCourseCover(course, null)).toBe(false);
    expect(setEstimatedMinutes(course, 0).estimatedMinutes).toBe(1);
    expect(setEstimatedMinutes(course, 12.4).estimatedMinutes).toBe(12);
    expect(setEstimatedMinutes(course, 9_999).estimatedMinutes).toBe(LIMITS.estimatedMinutes);
    expect('estimatedMinutes' in setEstimatedMinutes(setEstimatedMinutes(course, 5), null)).toBe(
      false,
    );
    expectValid(setEstimatedMinutes(course, 5));
  });

  it('tidies topics', () => {
    const course = setCourseTopics(make(), [' Billing ', 'billing', '', 'Calls', 'y'.repeat(60)]);
    expect(course.topics).toEqual(['Billing', 'Calls', 'y'.repeat(LIMITS.topic)]);
    expect(setCourseTopics(course, ['Billing', 'Calls', 'y'.repeat(LIMITS.topic)])).toBe(course);
    expect(
      setCourseTopics(
        make(),
        Array.from({ length: 15 }, (_, i) => `Topic ${i}`),
      ).topics,
    ).toHaveLength(LIMITS.topics);
    expect('topics' in setCourseTopics(course, [' '])).toBe(false);
    expectValid(course);
  });
});

describe('quiz rule for standard courses', () => {
  it('needs a quiz pass only when there is a quiz', () => {
    const withQuiz = syncQuizRule(make([quiz('q1')]));
    expect(withQuiz.settings.completion.requireQuizPass).toBe(true);
    expect(syncQuizRule({ ...withQuiz, lessons: [] }).settings.completion.requireQuizPass).toBe(
      false,
    );
    const microlearning = make([quiz('q1')], 'microlearning');
    expect(syncQuizRule(microlearning)).toBe(microlearning);
  });
});

describe('changeCourseType', () => {
  it("applies the new type's preset and keeps the author's other settings", () => {
    const course = changeCourseType(make([quiz('q1')]), 'certification');
    const preset = presetFor('certification');
    expect(course.type).toBe('certification');
    expect(course.settings.lessonOrder).toBe(preset.settings.lessonOrder);
    expect(course.settings.completion).toEqual(preset.settings.completion);
    expect(course.settings.certificate).toEqual(preset.settings.certificate);
    expect(course.settings.catalog).toEqual({ listed: false });
    expect(course.settings.labels).toEqual({ start: 'Begin' });
    expect(course.settings.minimumCourseSeconds).toBe(300);
    expect(course.lessons[0]).toMatchObject({ settings: { ...preset.quiz, poolSize: 2 } });
    expectValid(course);
  });

  it('keeps the quiz rule in step when going back to standard', () => {
    const course = changeCourseType(
      changeCourseType(make([quiz('q1')]), 'required_read'),
      'standard',
    );
    expect(course.settings.completion.requireQuizPass).toBe(true);
    expectValid(course);
  });

  it('does nothing for the same type', () => {
    const course = make();
    expect(changeCourseType(course, 'standard')).toBe(course);
  });
});

describe('updateCourseSettings', () => {
  it("applies each setting within the format's ranges", () => {
    const course = updateCourseSettings(make(), {
      lessonOrder: 'sequential',
      completion: { requireAcknowledgement: true },
      acknowledgement: 'I will greet every caller by name.',
      listed: true,
      certificate: { enabled: true, validForMonths: 500 },
      minimumCourseSeconds: 0,
      sidebar: 'closed',
      labels: { start: null, complete: 'Finish', submit: '  ' },
      reviewEveryMonths: 99,
    });
    expect(course.settings).toMatchObject({
      lessonOrder: 'sequential',
      completion: { requireAllLessons: true, requireAcknowledgement: true },
      acknowledgement: { statement: 'I will greet every caller by name.' },
      catalog: { listed: true },
      certificate: { enabled: true, validForMonths: LIMITS.certificateMonths },
      minimumCourseSeconds: 1,
      sidebar: 'closed',
      labels: { complete: 'Finish' },
      reviewEveryMonths: LIMITS.reviewEveryMonths,
    });
    expect(course.settings.labels).toEqual({ complete: 'Finish' });
    expectValid(course);
  });

  it('removes optional settings with null', () => {
    const course = updateCourseSettings(make(), {
      minimumCourseSeconds: null,
      acknowledgement: null,
      sidebar: null,
      labels: { start: null },
      reviewEveryMonths: null,
      certificate: { validForMonths: null },
    });
    for (const key of [
      'minimumCourseSeconds',
      'acknowledgement',
      'sidebar',
      'labels',
      'reviewEveryMonths',
    ]) {
      expect(key in course.settings).toBe(false);
    }
    expect('validForMonths' in course.settings.certificate).toBe(false);
    expectValid(course);
  });

  it('returns the course itself when nothing changes', () => {
    const course = make();
    expect(
      updateCourseSettings(course, {
        lessonOrder: course.settings.lessonOrder,
        labels: { start: 'Begin' },
      }),
    ).toBe(course);
  });
});

describe('duplicateCourse', () => {
  it('copies with fresh ids and links pointing at the copies', () => {
    const original = make([
      {
        id: 'l1',
        kind: 'content',
        title: 'Say hello',
        blocks: [
          { id: 'b1', type: 'button', label: 'Next', target: { kind: 'lesson', lessonId: 'q1' } },
        ],
      },
      quiz('q1'),
    ]);
    const copy = duplicateCourse(original, counter());
    expect(copy.title).toBe('Copy of Greeting new members');
    expect(copy.id).not.toBe(original.id);
    const ids = [...courseIds(copy)];
    expect(ids.some((id) => courseIds(original).has(id))).toBe(false);
    expect(copy.lessons[0]).toMatchObject({
      blocks: [{ target: { kind: 'lesson', lessonId: copy.lessons[1]?.id } }],
    });
    expect(copy.settings).toEqual(original.settings);
    expectValid(copy);
  });
});
