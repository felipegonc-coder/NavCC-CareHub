import type { Course, IsoDate } from '../format/index';
import { toCsv, type CsvColumn } from '../reports/index';
import { addMonths, compareDays, isoDateInTimeZone } from '../util/index';
import type { ReviewComment } from './api';

export * from './api';

// reviews module (B1): review links to a draft and the comments left through them (decision 0309), and the
// reminders for authors to check a live course again (`settings.reviewEveryMonths`).

/** Where a review link opens. The token stays in the fragment, which browsers never send (0309). */
export function reviewUrl(token: string): string {
  return `/learning/review#${token}`;
}

type ReviewTarget = Pick<ReviewComment, 'lessonId' | 'blockId' | 'questionId'>;

/** Where a comment sits in the course as it is now, in words, and its place for sorting. */
export type ReviewCommentPlace = { lesson: string; part: string; order: [number, number] };

const GONE = Number.MAX_SAFE_INTEGER;

/**
 * "3. Hand hygiene" and "Block 2", "Question 4" or "Whole lesson". A lesson, block or question that was
 * taken out of the draft after the comment was left says so, and sorts last.
 */
export function reviewCommentPlace(course: Course, comment: ReviewTarget): ReviewCommentPlace {
  const index = course.lessons.findIndex((lesson) => lesson.id === comment.lessonId);
  const lesson = course.lessons[index];
  if (!lesson) return { lesson: 'A removed lesson', part: '', order: [GONE, GONE] };
  const title = `${index + 1}. ${lesson.title.trim() || 'Untitled lesson'}`;
  const partOf = (ids: string[], id: string, name: 'Block' | 'Question'): ReviewCommentPlace => {
    const at = ids.indexOf(id);
    if (at === -1) {
      return { lesson: title, part: `A removed ${name.toLowerCase()}`, order: [index, GONE] };
    }
    return { lesson: title, part: `${name} ${at + 1}`, order: [index, at + 1] };
  };
  if (comment.blockId !== undefined) {
    const ids = lesson.kind === 'content' ? lesson.blocks.map((block) => block.id) : [];
    return partOf(ids, comment.blockId, 'Block');
  }
  if (comment.questionId !== undefined) {
    const ids = lesson.kind === 'quiz' ? lesson.questions.map((question) => question.id) : [];
    return partOf(ids, comment.questionId, 'Question');
  }
  return { lesson: title, part: 'Whole lesson', order: [index, 0] };
}

/** Whether the lesson, block or question a comment is about is still in the course. */
export function isReviewTargetInCourse(course: Course, target: ReviewTarget): boolean {
  const [lesson, part] = reviewCommentPlace(course, target).order;
  return lesson !== GONE && part !== GONE;
}

/** Comments in course order: by lesson, then block or question, then oldest first. */
export function sortReviewComments<C extends ReviewComment>(
  course: Course,
  comments: readonly C[],
): C[] {
  const places = new Map(comments.map((comment) => [comment, reviewCommentPlace(course, comment)]));
  const orderOf = (comment: C) => places.get(comment)?.order ?? [GONE, GONE];
  return [...comments].sort((a, b) => {
    const [lessonA, partA] = orderOf(a);
    const [lessonB, partB] = orderOf(b);
    return (
      lessonA - lessonB ||
      partA - partB ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  });
}

/**
 * A course's review comments as CSV, in course order: Lesson, Part, Comment, From, Date (a calendar day in
 * `timeZone`, UTC by default) and Status (Open or Resolved).
 */
export function reviewCommentsCsv(
  course: Course,
  comments: readonly ReviewComment[],
  options: { timeZone?: string; bom?: boolean } = {},
): string {
  const columns: CsvColumn<ReviewComment>[] = [
    { header: 'Lesson', value: (comment) => reviewCommentPlace(course, comment).lesson },
    { header: 'Part', value: (comment) => reviewCommentPlace(course, comment).part },
    { header: 'Comment', value: (comment) => comment.body },
    { header: 'From', value: (comment) => comment.author.name },
    {
      header: 'Date',
      value: (comment) => isoDateInTimeZone(comment.createdAt, options.timeZone ?? 'UTC'),
    },
    { header: 'Status', value: (comment) => (comment.resolved ? 'Resolved' : 'Open') },
  ];
  return toCsv(columns, sortReviewComments(course, comments), options.bom ? { bom: true } : {});
}

/**
 * When the author is next reminded to check a live course: `everyMonths` after it was last published, or after
 * the last reminder when that came later. Null when the course has no review interval.
 */
export function reviewDueOn(
  everyMonths: number | undefined,
  publishedOn: IsoDate,
  lastRemindedOn: IsoDate | null = null,
): IsoDate | null {
  if (everyMonths === undefined) return null;
  const from =
    lastRemindedOn !== null && compareDays(lastRemindedOn, publishedOn) > 0
      ? lastRemindedOn
      : publishedOn;
  return addMonths(from, everyMonths);
}

/** A notice's words and its one button (decision 0313). */
export type ReviewReminderNotice = {
  title: string;
  text: string;
  buttons: { label: string; href: string }[];
};

/**
 * The reminder to check a course, with one button that opens it in Studio. The title is the same for every
 * course (notice titles never carry one); the text names the course only when the author can open it
 * (`canOpen`, decision 0313).
 */
export function reviewReminderNotice(
  course: { id: string; title: string },
  everyMonths: number,
  options: { canOpen: boolean },
): ReviewReminderNotice {
  const months = everyMonths === 1 ? 'a month' : `${everyMonths} months`;
  const named = `“${course.title.trim() || 'Untitled course'}”`;
  return {
    title: 'Time to check a course',
    text: `It's been ${months} since ${options.canOpen ? named : 'one of your courses'} was published or last checked. Make sure it's still right, and publish any changes.`,
    buttons: [
      {
        label: 'Open in Studio',
        href: `/learning/studio/courses/${encodeURIComponent(course.id)}`,
      },
    ],
  };
}
