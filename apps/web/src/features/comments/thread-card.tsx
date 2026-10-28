import { commentUrl, type CommentThreadView, type CommentView } from '@carehub/shared';
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  useToast,
} from '@carehub/ui';
import { Check, Link2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { fullLink } from '../../lib/links';
import { Composer } from './composer';
import { useCommentsContext } from './context';
import type { OutgoingComment } from './outbox';
import { formatWhen, fullDate, nameOf, textParts } from './threads';

const SPOTS = {
  page: 'On the page',
  text: 'On text',
  block: 'On a block',
  property: 'On a property',
} as const;

const plural = (count: number) => (count === 1 ? '1 comment' : `${count} comments`);

/** ↑ and ↓ on a thread move to the one before or after it in the list. */
function moveBetweenThreads(event: KeyboardEvent<HTMLButtonElement>) {
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return;
  const list = event.currentTarget.closest('[data-thread-list]');
  const threads = Array.from(list?.querySelectorAll<HTMLElement>('[data-thread-open]') ?? []);
  const next = threads[threads.indexOf(event.currentTarget) + step];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export interface ThreadCardProps {
  thread: CommentThreadView;
  /** Its text is no longer on the page: "The text this was on was deleted." with the quote. */
  gone?: boolean;
  /** Clicking the thread, or Enter on it: the page scrolls to its spot and highlights it. */
  onOpen?(thread: CommentThreadView): void;
}

/** A thread in the comments panel: what it's on, its comments, and a reply box. */
export function ThreadCard({ thread, gone = false, onOpen }: ThreadCardProps) {
  const { canComment, actions } = useCommentsContext();
  const [editing, setEditing] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reply = useRef<HTMLTextAreaElement>(null);
  const resolved = thread.resolvedAt !== null;
  const sending = actions.outgoing.filter((item) => item.input.threadId === thread.id);
  // Only the author can edit a comment.
  const lastOwn = thread.comments.findLast((comment) => comment.canEdit && !comment.deleted);

  return (
    <article
      aria-label={`${SPOTS[thread.spot]}, ${plural(thread.comments.length)}`}
      className={cn('flex flex-col gap-3 rounded border border-border p-3', resolved && 'bg-fill')}
    >
      <div className="flex items-start gap-2">
        <button
          ref={opener}
          type="button"
          data-thread-open=""
          onClick={() => {
            onOpen?.(thread);
            reply.current?.focus();
          }}
          onKeyDown={moveBetweenThreads}
          className="flex min-w-0 flex-1 flex-col gap-1 rounded text-left text-small text-muted hover:text-fg"
        >
          {gone && <span className="italic">The text this was on was deleted.</span>}
          {thread.quote ? (
            <span className="line-clamp-2 border-l-2 border-warning pl-2">{thread.quote}</span>
          ) : (
            <span>{SPOTS[thread.spot]}</span>
          )}
        </button>
        {thread.canResolve && (
          <IconButton
            label={resolved ? 'Reopen' : 'Resolve'}
            size="sm"
            onClick={() => void actions.resolve(thread.id, !resolved)}
          >
            {resolved ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
          </IconButton>
        )}
      </div>
      <ol className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            editing={editing === comment.id}
            onEditing={(on) => {
              setEditing(on ? comment.id : null);
              if (!on) reply.current?.focus();
            }}
          />
        ))}
        {sending.map((item) => (
          <OutgoingItem key={item.id} item={item} />
        ))}
      </ol>
      {canComment && (
        <Composer
          boxRef={reply}
          label="Reply"
          placeholder="Reply…"
          onSubmit={(text) => {
            void actions.send({ threadId: thread.id, text });
          }}
          onCancel={() => opener.current?.focus()}
          onEditLast={lastOwn && (() => setEditing(lastOwn.id))}
        />
      )}
    </article>
  );
}

interface CommentItemProps {
  comment: CommentView;
  editing: boolean;
  onEditing(on: boolean): void;
}

function CommentItem({ comment, editing, onEditing }: CommentItemProps) {
  const { pageId, people, actions } = useCommentsContext();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const author = people[comment.authorId];
  const name = nameOf(people, comment.authorId);

  const copyLink = async () => {
    try {
      const link = fullLink(commentUrl(pageId, comment.id));
      await navigator.clipboard.writeText(link);
      toast({ title: 'Link copied' });
    } catch {
      toast({ title: "Couldn't copy the link.", variant: 'danger' });
    }
  };

  return (
    <li className="group/comment flex gap-2">
      <Avatar name={name} src={author?.avatarUrl ?? undefined} size="sm" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-8 items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-small">
            <span className="font-medium">{name}</span>{' '}
            <time
              dateTime={comment.createdAt}
              title={fullDate.format(new Date(comment.createdAt))}
              className="text-label text-muted"
            >
              {formatWhen(comment.createdAt)}
            </time>
            {comment.editedAt && <span className="text-label text-muted"> (edited)</span>}
          </p>
          {!comment.deleted && !editing && (
            <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/comment:opacity-100 max-md:opacity-100">
              {comment.canEdit && (
                <IconButton label="Edit comment" size="sm" onClick={() => onEditing(true)}>
                  <Pencil aria-hidden />
                </IconButton>
              )}
              <IconButton label="Copy link to comment" size="sm" onClick={() => void copyLink()}>
                <Link2 aria-hidden />
              </IconButton>
              {comment.canDelete && (
                <IconButton label="Delete comment" size="sm" onClick={() => setConfirming(true)}>
                  <Trash2 aria-hidden />
                </IconButton>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <Composer
            label="Edit comment"
            initialText={comment.text}
            submitLabel="Save"
            focusOnMount
            onSubmit={async (text) => {
              const saved = await actions.edit(comment.id, text);
              if (saved) onEditing(false);
              return saved;
            }}
            onCancel={() => onEditing(false)}
          />
        ) : comment.deleted ? (
          <p className="text-small italic text-muted">This comment was deleted</p>
        ) : (
          <CommentText text={comment.text} />
        )}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this comment?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void actions.remove(comment.id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** A reply on its way: faded while it's sent, with "Not sent · Retry · Delete" if it failed. */
function OutgoingItem({ item }: { item: OutgoingComment }) {
  const { viewer, actions } = useCommentsContext();
  const name = viewer?.name ?? 'You';
  const failed = item.status === 'failed';
  return (
    <li aria-busy={!failed || undefined} className={cn('flex gap-2', !failed && 'opacity-60')}>
      <Avatar name={name} src={viewer?.avatarUrl ?? undefined} size="sm" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-h-8 items-center text-small font-medium">{name}</p>
        <CommentText text={item.input.text} />
        {failed && (
          <p role="alert" title={item.error} className="text-label text-danger">
            Not sent ·{' '}
            <button type="button" className="underline" onClick={() => void actions.retry(item.id)}>
              Retry
            </button>{' '}
            ·{' '}
            <button type="button" className="underline" onClick={() => actions.discard(item.id)}>
              Delete
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

/** Comment text, with the people mentioned shown as @Name. */
function CommentText({ text }: { text: string }) {
  const { people } = useCommentsContext();
  return (
    <p className="whitespace-pre-wrap break-words text-small">
      {textParts(text).map((part, index) => (
        <Fragment key={index}>
          {'userId' in part ? (
            <span className="font-medium text-primary">@{nameOf(people, part.userId)}</span>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </p>
  );
}
