import {
  DEFAULT_REVIEW_LINK_DAYS,
  REVIEW_LINK_DAYS,
  reviewCommentPlace,
  sortReviewComments,
  type Course,
  type Id,
  type NewReviewLink,
  type ReviewComment,
  type ReviewLinkDays,
} from '@carehub/learning';
import { Button, buttonClasses, ErrorState, Field, Input, LoadingState } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { LearningApiError } from '../data';
import { ChoiceButtons } from '../studio/fields';
import {
  reviewCommentsCsvHref,
  useCourseReviewComments,
  useResolveComment,
  useReviewLinks,
  useShareForReview,
  useStopSharing,
} from './studio-data';

// Studio's side of reviews (B1, decision 0309), for the course editor (B8) to place: share the draft by link,
// stop sharing, and read, resolve and download the comments that come back.

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const day = (isoDateTime: string) => dayFormat.format(new Date(isoDateTime));
const DAY_OPTIONS = REVIEW_LINK_DAYS.map((days) => ({ value: days, label: `${days} days` }));

/** The server's plain message, or `fallback` when the call failed some other way. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof LearningApiError ? error.message : fallback;

/** Shares a course's draft for review: make a link and copy it, see the open links, stop sharing one. */
export function ReviewSharing({ courseId }: { courseId: Id }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [days, setDays] = useState<ReviewLinkDays>(DEFAULT_REVIEW_LINK_DAYS);
  const [made, setMade] = useState<NewReviewLink | null>(null);
  const [notice, setNotice] = useState('');
  const share = useShareForReview(courseId);

  function stopped(linkId: Id) {
    if (made?.id === linkId) setMade(null);
    setNotice('Sharing stopped. That link no longer opens the draft.');
    heading.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} ref={heading} tabIndex={-1} className="text-h3 text-fg">
          Share for review
        </h2>
        <p className="text-body text-muted">
          People in your workspace who have the link can read the latest draft and leave comments.
          They can't change it.
        </p>
        <p aria-live="polite" className="text-small text-muted">
          {notice}
        </p>
      </div>
      <ChoiceButtons
        label="The link works for"
        value={days}
        options={DAY_OPTIONS}
        onChange={(next) => setDays(next)}
      />
      <Button
        variant="secondary"
        loading={share.isPending}
        onClick={() => {
          setNotice('');
          share.mutate(days, { onSuccess: (link) => setMade(link) });
        }}
        className="self-start"
      >
        Make a link
      </Button>
      {share.isError && (
        <p role="alert" className="text-small text-danger">
          {messageOf(share.error, "The link wasn't made. Try again.")}
        </p>
      )}
      {made && <NewLink key={made.id} link={made} />}
      <OpenLinks courseId={courseId} onStopped={stopped} />
    </section>
  );
}

/** A link just made. Its address is shown only now, so focus moves to it, ready to copy. */
function NewLink({ link }: { link: NewReviewLink }) {
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const href = new URL(link.url, window.location.origin).href;

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-fill p-4">
      <Field
        label="Review link"
        hint={`Copy it now: it's shown only this once. It works until ${day(link.expiresAt)}.`}
      >
        <Input ref={field} readOnly value={href} onFocus={(event) => event.target.select()} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void copy()}>
          Copy link
        </Button>
        <p aria-live="polite" className="text-small text-muted">
          {copied === 'copied'
            ? 'Copied.'
            : copied === 'failed'
              ? "Couldn't copy. Select the link and copy it yourself."
              : ''}
        </p>
      </div>
    </div>
  );
}

/** The links that still open the draft: who made each one, and until when it works. */
function OpenLinks({ courseId, onStopped }: { courseId: Id; onStopped(linkId: Id): void }) {
  const idPrefix = useId();
  const links = useReviewLinks(courseId);
  const stop = useStopSharing(courseId);
  if (links.isPending) return <LoadingState label="Loading review links" />;
  if (links.isError) {
    return (
      <ErrorState
        message={messageOf(links.error, "The review links didn't load.")}
        onRetry={() => void links.refetch()}
        retrying={links.isRefetching}
      />
    );
  }
  if (links.data.length === 0) return <p className="text-small text-muted">No links are open.</p>;
  return (
    <div className="flex flex-col gap-2">
      <h3 id={`${idPrefix}-heading`} className="text-label text-muted">
        Open links
      </h3>
      <ul aria-labelledby={`${idPrefix}-heading`} className="flex flex-col gap-2">
        {links.data.map((link) => (
          <li
            key={link.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-4 py-3"
          >
            <p id={`${idPrefix}-${link.id}`} className="text-small text-fg">
              {`Made by ${link.createdBy.name} on ${day(link.createdAt)} · works until ${day(link.expiresAt)}`}
            </p>
            <Button
              variant="secondary"
              size="sm"
              aria-describedby={`${idPrefix}-${link.id}`}
              loading={stop.isPending && stop.variables === link.id}
              onClick={() => stop.mutate(link.id, { onSuccess: () => onStopped(link.id) })}
            >
              Stop sharing
            </Button>
          </li>
        ))}
      </ul>
      {stop.isError && (
        <p role="alert" className="text-small text-danger">
          {messageOf(stop.error, "Sharing didn't stop. Try again.")}
        </p>
      )}
    </div>
  );
}

type Show = 'open' | 'all';
const SHOW_OPTIONS: readonly { value: Show; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
];

/** The comments reviewers left on a course, in course order: resolve or reopen them, or download them as CSV. */
export function ReviewComments({ course }: { course: Course }) {
  const headingId = useId();
  const comments = useCourseReviewComments(course.id);
  const resolve = useResolveComment(course.id);
  const [show, setShow] = useState<Show>('open');
  // Comments resolved while showing open ones stay in view until the choice changes, with Reopen at hand.
  const [kept, setKept] = useState<ReadonlySet<Id>>(() => new Set());
  const all = comments.data ?? [];
  const open = all.filter((comment) => !comment.resolved).length;

  function toggle(comment: ReviewComment) {
    if (!comment.resolved) setKept((ids) => new Set(ids).add(comment.id));
    resolve.mutate({ id: comment.id, resolved: !comment.resolved });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-h3 text-fg">
            Review comments
          </h2>
          {all.length > 0 && (
            <p className="text-small text-muted">{`${open} open · ${all.length - open} resolved`}</p>
          )}
        </div>
        {all.length > 0 && (
          <a
            href={reviewCommentsCsvHref(course.id)}
            download
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            Download CSV
          </a>
        )}
      </div>
      {comments.isPending ? (
        <LoadingState label="Loading review comments" />
      ) : comments.isError ? (
        <ErrorState
          message={messageOf(comments.error, "The comments didn't load.")}
          onRetry={() => void comments.refetch()}
          retrying={comments.isRefetching}
        />
      ) : all.length === 0 ? (
        <p className="text-small text-muted">
          No comments yet. Share the draft for review to get some.
        </p>
      ) : (
        <>
          <ChoiceButtons
            label="Show"
            value={show}
            options={SHOW_OPTIONS}
            onChange={(next) => {
              setShow(next);
              setKept(new Set());
            }}
          />
          <CommentList
            course={course}
            comments={sortReviewComments(course, all).filter(
              (comment) => show === 'all' || !comment.resolved || kept.has(comment.id),
            )}
            pendingId={resolve.isPending ? (resolve.variables?.id ?? null) : null}
            onToggle={toggle}
          />
          {resolve.isError && (
            <p role="alert" className="text-small text-danger">
              {messageOf(resolve.error, "That didn't save. Try again.")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

type CommentListProps = {
  course: Course;
  comments: readonly ReviewComment[];
  pendingId: Id | null;
  onToggle(comment: ReviewComment): void;
};

function CommentList({ course, comments, pendingId, onToggle }: CommentListProps) {
  const idPrefix = useId();
  if (comments.length === 0) return <p className="text-small text-muted">No open comments.</p>;
  return (
    <ul aria-label="Review comments" className="flex flex-col gap-2">
      {comments.map((comment) => {
        const place = reviewCommentPlace(course, comment);
        return (
          <li
            key={comment.id}
            className="flex flex-col gap-2 rounded border border-border px-4 py-3"
          >
            <p className="text-small text-muted">
              {[place.lesson, place.part].filter(Boolean).join(' · ')}
            </p>
            <p id={`${idPrefix}-${comment.id}`} className="whitespace-pre-wrap text-body text-fg">
              {comment.body}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-small text-muted">
                {`${comment.author.name} · ${day(comment.createdAt)}${comment.resolved ? ' · Resolved' : ''}`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                aria-describedby={`${idPrefix}-${comment.id}`}
                loading={pendingId === comment.id}
                onClick={() => onToggle(comment)}
              >
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
