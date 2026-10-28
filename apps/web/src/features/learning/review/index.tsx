import {
  blockAnchorId,
  isReviewTargetInCourse,
  linkTarget,
  reduceProgress,
  reviewCommentPlace,
  type Course,
  type CreateReviewCommentRequest,
  type Link,
  type ReviewComment,
  type ReviewReply,
} from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
import { LearningApiError } from '../data';
import { ScreenLoading, ScreenMessage } from '../player/ScreenMessage';
import { useAddReviewComment, useReview } from './data';
import { useDayFormat } from './dates';
import { ReviewLesson, lessonAnchorId } from './ReviewLesson';
import { reviewTokenFrom } from './token';

// The review screen (decision 0309): a draft shared by link, read-only and in full, with comments on its
// lessons, blocks and quiz questions. Reviewers see the comments left through their link.

const NOT_FOUND = 'This was deleted, or the link is wrong.';

/** `/learning/review#<token>`: a draft shared for review. The token is in the fragment, never the path. */
export function ReviewScreen() {
  const token = reviewTokenFrom(useLocation().hash);
  if (token === null) return <ScreenMessage title="Review course" text={NOT_FOUND} />;
  return <Review key={token} token={token} />;
}

function Review({ token }: { token: string }) {
  const review = useReview(token);
  const add = useAddReviewComment(token);
  if (review.isPending) return <ScreenLoading label="Opening the draft" />;
  if (review.isError) {
    const status = review.error instanceof LearningApiError ? review.error.status : null;
    if (status === 404) return <ScreenMessage title="Review course" text={NOT_FOUND} />;
    return (
      <ScreenMessage
        title="This draft didn't load"
        text={
          review.error instanceof LearningApiError
            ? review.error.message
            : 'Reload the page, then try again.'
        }
      >
        <Button onClick={() => void review.refetch()} className="max-md:h-11">
          Try again
        </Button>
      </ScreenMessage>
    );
  }
  return <ReviewDraft review={review.data} send={add.mutateAsync} />;
}

/** Links to lessons and blocks scroll to them here; anything else opens in a new tab, so the review stays open. */
function useReviewLinks(course: Course) {
  return useCallback(
    (link: Link) => {
      const target = linkTarget(course, link);
      if (target.kind === 'broken') return;
      if (target.kind === 'lesson') {
        const id =
          target.blockId === undefined
            ? lessonAnchorId(target.lessonId)
            : blockAnchorId(target.blockId);
        document.getElementById(id)?.scrollIntoView();
        return;
      }
      window.open(target.href, '_blank', 'noopener,noreferrer');
    },
    [course],
  );
}

type ReviewDraftProps = {
  review: ReviewReply;
  send(input: CreateReviewCommentRequest): Promise<unknown>;
};

function ReviewDraft({ review, send }: ReviewDraftProps) {
  const { course, comments, expiresAt } = review;
  const state = useMemo(() => reduceProgress(course, []), [course]);
  const go = useReviewLinks(course);
  const day = useDayFormat();
  const removed = comments.filter((comment) => !isReviewTargetInCourse(course, comment));
  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-8 px-6 py-16">
      <title>{`Care Hub · Review: ${course.title}`}</title>
      <header className="flex flex-col gap-2">
        <p className="text-small text-muted">Draft for review</p>
        <h1 className="text-title text-fg">{course.title}</h1>
        <p className="text-body text-muted">
          {`Read the draft and leave comments for its authors. This link works until ${day(expiresAt)}.`}
        </p>
      </header>
      {course.lessons.map((lesson, index) => (
        <ReviewLesson
          key={lesson.id}
          course={course}
          lesson={lesson}
          number={index + 1}
          comments={comments}
          state={state}
          go={go}
          send={send}
        />
      ))}
      {removed.length > 0 && <RemovedComments course={course} comments={removed} />}
    </main>
  );
}

/** Comments on lessons, blocks or questions that were taken out of the draft since. */
function RemovedComments({ course, comments }: { course: Course; comments: ReviewComment[] }) {
  return (
    <section
      aria-label="Comments on removed parts"
      className="flex flex-col gap-3 border-t border-border pt-8"
    >
      <h2 className="text-h2 text-fg">Comments on removed parts</h2>
      <ul className="flex flex-col gap-2">
        {comments.map((comment) => {
          const place = reviewCommentPlace(course, comment);
          return (
            <li key={comment.id} className="rounded border border-border bg-fill px-4 py-3">
              <p className="text-small text-muted">
                {[place.lesson, place.part, comment.author.name].filter(Boolean).join(' · ')}
              </p>
              <p className="whitespace-pre-wrap text-body text-fg">{comment.body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
