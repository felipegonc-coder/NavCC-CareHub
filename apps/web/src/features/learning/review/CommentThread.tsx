import {
  CreateReviewCommentRequestSchema,
  type CreateReviewCommentRequest,
  type ReviewComment,
} from '@carehub/learning';
import { Button, Field, Textarea } from '@carehub/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LearningApiError } from '../data';
import { useDayFormat } from './dates';

/** What a comment is about: a lesson, or one block or quiz question in it. */
export type ReviewTarget = Pick<CreateReviewCommentRequest, 'lessonId' | 'blockId' | 'questionId'>;

type CommentThreadProps = {
  /** "this lesson", "this block" or "question 2". */
  what: string;
  target: ReviewTarget;
  comments: readonly ReviewComment[];
  send(input: CreateReviewCommentRequest): Promise<unknown>;
};

/** The comments on one part of the draft, oldest first, and a form to add one. */
export function CommentThread({ what, target, comments, send }: CommentThreadProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const day = useDayFormat();

  // Focus moves into the form when it opens, and back to its button when it closes.
  useEffect(() => {
    if (open) field.current?.focus();
    else if (opened.current) opener.current?.focus();
    opened.current = open;
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = CreateReviewCommentRequestSchema.safeParse({ ...target, body });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the comment, then try again.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await send(input.data);
      setBody('');
      setOpen(false);
    } catch (failure) {
      setError(
        failure instanceof LearningApiError
          ? failure.message
          : "The comment wasn't sent. Try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {comments.length > 0 && (
        <ul aria-label={`Comments on ${what}`} className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded border border-border bg-fill px-4 py-3">
              <p className="text-small text-muted">
                {comment.author.name} · {day(comment.createdAt)}
                {comment.resolved && ' · Resolved'}
              </p>
              <p className="whitespace-pre-wrap text-body text-fg">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <Field label={`Your comment on ${what}`} error={error ?? undefined}>
            <Textarea ref={field} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={sending} className="max-md:h-11">
              Send
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="max-md:h-11"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={opener}
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="self-start max-md:h-11"
        >
          {`Comment on ${what}`}
        </Button>
      )}
    </div>
  );
}
