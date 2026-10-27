import { describe, expect, it } from 'vitest';
import type { Course } from '../format/index';
import { sampleStandardCourse } from '../fixtures/index';
import {
  isReviewTargetInCourse,
  reviewCommentPlace,
  reviewCommentsCsv,
  reviewDueOn,
  reviewReminderNotice,
  reviewUrl,
  sortReviewComments,
  type ReviewComment,
} from './index';

const course: Course = sampleStandardCourse;
const [first, second] = course.lessons;
const quiz = course.lessons.find((lesson) => lesson.kind === 'quiz');

function comment(id: string, at: string, target: Partial<ReviewComment>): ReviewComment {
  return {
    id,
    lessonId: first?.id ?? '',
    body: `Comment ${id}`,
    author: { id: 'person-1', name: 'Rhea Reviewer' },
    createdAt: at,
    resolved: false,
    ...target,
  };
}

describe('review links and comments', () => {
  it('puts the token in the fragment of the review link', () => {
    expect(reviewUrl('Ab0-_')).toBe('/learning/review#Ab0-_');
  });

  it('says where a comment is: lesson number and title, then the block or question', () => {
    expect(first?.kind).toBe('content');
    expect(quiz).toBeDefined();
    const blockId = first?.kind === 'content' ? first.blocks[1]?.id : undefined;
    const questionId = quiz?.kind === 'quiz' ? quiz.questions[2]?.id : undefined;
    const title = `1. ${first?.title}`;
    expect(reviewCommentPlace(course, { lessonId: first?.id ?? '' })).toEqual({
      lesson: title,
      part: 'Whole lesson',
      order: [0, 0],
    });
    expect(reviewCommentPlace(course, { lessonId: first?.id ?? '', blockId })).toEqual({
      lesson: title,
      part: 'Block 2',
      order: [0, 2],
    });
    const quizIndex = course.lessons.indexOf(quiz as (typeof course.lessons)[number]);
    expect(reviewCommentPlace(course, { lessonId: quiz?.id ?? '', questionId })).toMatchObject({
      lesson: `${quizIndex + 1}. ${quiz?.title}`,
      part: 'Question 3',
    });
  });

  it('says when the lesson, block or question was taken out since', () => {
    expect(reviewCommentPlace(course, { lessonId: 'gone' })).toMatchObject({
      lesson: 'A removed lesson',
      part: '',
    });
    expect(
      reviewCommentPlace(course, { lessonId: first?.id ?? '', blockId: 'gone' }),
    ).toMatchObject({ part: 'A removed block' });
    expect(
      reviewCommentPlace(course, { lessonId: quiz?.id ?? '', blockId: 'calls-before-text' }),
    ).toMatchObject({ part: 'A removed block' });
    expect(
      reviewCommentPlace(course, { lessonId: first?.id ?? '', questionId: 'calls-q-first' }),
    ).toMatchObject({ part: 'A removed question' });
    expect(isReviewTargetInCourse(course, { lessonId: first?.id ?? '' })).toBe(true);
    expect(isReviewTargetInCourse(course, { lessonId: 'gone' })).toBe(false);
    expect(isReviewTargetInCourse(course, { lessonId: first?.id ?? '', blockId: 'gone' })).toBe(
      false,
    );
  });

  it('sorts comments in course order, then oldest first, with removed parts last', () => {
    const blockId = first?.kind === 'content' ? first.blocks[0]?.id : undefined;
    const late = comment('c1', '2026-10-27T12:00:00.000Z', { lessonId: second?.id ?? '' });
    const gone = comment('c2', '2026-10-27T09:00:00.000Z', { lessonId: 'gone' });
    const onBlock = comment('c3', '2026-10-27T11:00:00.000Z', { blockId });
    const onLesson = comment('c4', '2026-10-27T11:30:00.000Z', {});
    const earlier = comment('c5', '2026-10-27T10:00:00.000Z', { blockId });
    expect(
      sortReviewComments(course, [late, gone, onBlock, onLesson, earlier]).map((c) => c.id),
    ).toEqual(['c4', 'c5', 'c3', 'c1', 'c2']);
  });

  it('exports comments as CSV in course order, dated in the time zone given', () => {
    const blockId = first?.kind === 'content' ? first.blocks[0]?.id : undefined;
    const csv = reviewCommentsCsv(
      course,
      [
        comment('c1', '2026-10-27T03:00:00.000Z', { lessonId: second?.id ?? '', resolved: true }),
        comment('c2', '2026-10-27T03:00:00.000Z', { blockId, body: '=SUM(A1), "really"' }),
      ],
      { timeZone: 'America/Denver' },
    );
    expect(csv.split('\r\n')).toEqual([
      'Lesson,Part,Comment,From,Date,Status',
      `1. ${first?.title},Block 1,"'=SUM(A1), ""really""",Rhea Reviewer,2026-10-26,Open`,
      `2. ${second?.title},Whole lesson,Comment c1,Rhea Reviewer,2026-10-26,Resolved`,
      '',
    ]);
    expect(reviewCommentsCsv(course, [], { bom: true })).toBe(
      '\uFEFFLesson,Part,Comment,From,Date,Status\r\n',
    );
    expect(reviewCommentsCsv(course, [comment('c3', '2026-10-27T03:00:00.000Z', {})])).toContain(
      ',2026-10-27,Open',
    );
  });

  it('reminds authors every so many months after publishing, or after the last reminder', () => {
    expect(reviewDueOn(undefined, '2026-01-31')).toBeNull();
    expect(reviewDueOn(1, '2026-01-31')).toBe('2026-02-28');
    expect(reviewDueOn(12, '2026-03-15', '2027-03-15')).toBe('2028-03-15');
    expect(reviewDueOn(6, '2026-09-01', '2026-03-01')).toBe('2027-03-01');
    expect(reviewDueOn(6, '2026-09-01', null)).toBe('2027-03-01');
  });

  it('names the course in the reminder only to authors who can open it', () => {
    const course = { id: 'course-1', title: 'Calls with care' };
    expect(reviewReminderNotice(course, 12, { canOpen: true })).toEqual({
      title: 'Time to check a course',
      text: "It's been 12 months since “Calls with care” was published or last checked. Make sure it's still right, and publish any changes.",
      buttons: [{ label: 'Open in Studio', href: '/learning/studio/courses/course-1' }],
    });
    const hidden = reviewReminderNotice(course, 1, { canOpen: false });
    expect(hidden.title).toBe('Time to check a course');
    expect(hidden.text).toBe(
      "It's been a month since one of your courses was published or last checked. Make sure it's still right, and publish any changes.",
    );
    expect(JSON.stringify(hidden)).not.toContain('Calls with care');
    expect(hidden.buttons).toHaveLength(1);
  });
});
