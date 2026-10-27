import { Copy, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import {
  COPY,
  parseMessageText,
  personName,
  safeHref,
  systemLineText,
  type MessageJson,
  type MessageSegment,
  type PeopleJson,
} from '@carehub/team-chat';
import {
  Avatar,
  buttonClasses,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  VisuallyHidden,
} from '@carehub/ui';
import { nameLookup, senderName } from './chat-info';
import { fullTime, messageTime } from './format';
import type { PendingMessage } from './outbox';
import type { ListRow } from './rows';

export interface RowContext {
  viewerId: string;
  people: PeopleJson;
  editingId: string | null;
  onCopy(message: MessageJson): void;
  onEdit(message: MessageJson): void;
  onDelete(message: MessageJson): void;
  onRetry(clientId: string): void;
  onDiscard(clientId: string): void;
}

function Segment({ segment, people }: { segment: MessageSegment; people: PeopleJson }) {
  if (segment.type === 'text') return segment.text;
  if (segment.type === 'mention') {
    return (
      <span className="rounded-sm bg-fill px-0.5 font-medium text-primary">
        @{personName(people[segment.userId])}
      </span>
    );
  }
  const href = safeHref(segment.url);
  if (!href) return segment.url;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      {segment.url}
    </a>
  );
}

function MessageText({ message, people }: { message: MessageJson; people: PeopleJson }) {
  if (message.deletedAt) return <p className="italic text-muted">{COPY.deletedMessage}</p>;
  const segments = parseMessageText(message.text, { mentionable: message.mentions });
  return (
    <p className="whitespace-pre-wrap break-words" data-testid="messages-message-text">
      {segments.map((segment, index) => (
        <Segment key={index} segment={segment} people={people} />
      ))}
      {message.editedAt && <span className="text-small text-muted"> ({COPY.edited})</span>}
    </p>
  );
}

/** The sender's picture and, for the first of a run, their name and the time. */
function Sender({ name, first, iso }: { name: string; first: boolean; iso: string | null }) {
  const time = iso ? messageTime(iso) : null;
  if (!first) return <VisuallyHidden>{time ? `${name}, ${time}: ` : `${name}: `}</VisuallyHidden>;
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-semibold">{name}</span>
      {iso && (
        <time dateTime={iso} title={fullTime(iso)} className="text-small text-muted">
          {time}
        </time>
      )}
    </p>
  );
}

function MessageMenu({
  message,
  own,
  context,
  label,
}: {
  message: MessageJson;
  own: boolean;
  context: RowContext;
  label: string;
}) {
  // Edit and Delete move focus to the composer or a dialog, so the menu doesn't take it back.
  const focusMoves = useRef(false);
  const moving = (action: () => void) => () => {
    focusMoves.current = true;
    action();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        data-testid="messages-message-menu"
        className={buttonClasses({
          variant: 'ghost',
          size: 'sm',
          icon: true,
          className:
            'absolute right-4 top-0 bg-bg shadow-menu md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100',
        })}
      >
        <Ellipsis className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!focusMoves.current) return;
          focusMoves.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={() => context.onCopy(message)}>
          <Copy className="size-4" aria-hidden />
          Copy text
        </DropdownMenuItem>
        {own && (
          <>
            <DropdownMenuItem onSelect={moving(() => context.onEdit(message))}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger" onSelect={moving(() => context.onDelete(message))}>
              <Trash2 className="size-4" aria-hidden />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MessageRow({
  message,
  first,
  context,
}: {
  message: MessageJson;
  first: boolean;
  context: RowContext;
}) {
  const name = senderName(message, context.people);
  const own = message.senderId !== null && message.senderId === context.viewerId;
  return (
    <li
      data-anchor={message.id}
      data-testid="messages-message"
      className={cn(
        'group relative flex gap-3 px-4 py-1 hover:bg-fill-hover focus-within:bg-fill-hover',
        first && 'mt-2',
        context.editingId === message.id && 'bg-fill',
      )}
    >
      <div className="w-8 shrink-0">{first && <Avatar name={name} size="sm" decorative />}</div>
      <div className="min-w-0 flex-1 pr-8">
        <Sender name={name} first={first} iso={message.createdAt} />
        <MessageText message={message} people={context.people} />
      </div>
      {!message.deletedAt && (
        <MessageMenu
          message={message}
          own={own}
          context={context}
          label={`Message from ${name}, ${messageTime(message.createdAt)}: actions`}
        />
      )}
    </li>
  );
}

const inlineButton = 'font-medium underline hover:text-fg';

function PendingRow({
  pending,
  first,
  context,
}: {
  pending: PendingMessage;
  first: boolean;
  context: RowContext;
}) {
  const name = personName(context.people[context.viewerId]);
  return (
    <li
      data-anchor={pending.clientId}
      data-testid="messages-pending"
      className={cn('flex gap-3 px-4 py-1', first && 'mt-2')}
    >
      <div className="w-8 shrink-0">{first && <Avatar name={name} size="sm" decorative />}</div>
      <div className="min-w-0 flex-1">
        <Sender name={name} first={first} iso={null} />
        <p
          className={cn(
            'whitespace-pre-wrap break-words',
            pending.status !== 'failed' && 'opacity-60',
          )}
        >
          {pending.text}
        </p>
        {pending.status === 'sending' && <p className="text-small text-muted">Sending…</p>}
        {pending.status === 'waiting' && (
          <p className="text-small text-muted">Will send when you're back online.</p>
        )}
        {pending.status === 'failed' && (
          <div className="text-small">
            <p className="flex flex-wrap items-center gap-1 text-danger">
              Not sent
              <span aria-hidden>·</span>
              <button
                type="button"
                className={inlineButton}
                onClick={() => context.onRetry(pending.clientId)}
              >
                Retry
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className={inlineButton}
                onClick={() => context.onDiscard(pending.clientId)}
              >
                Delete
              </button>
            </p>
            {pending.error && <p className="text-muted">{pending.error}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

/** One line of the message list. */
export function Row({ row, context }: { row: ListRow; context: RowContext }) {
  switch (row.kind) {
    case 'day':
      return (
        <li className="px-4 pb-1 pt-4">
          <h3 className="text-center text-label text-muted">{row.label}</h3>
        </li>
      );
    case 'new-messages':
      return (
        <li
          data-new-messages=""
          data-testid="messages-new-line"
          className="flex items-center gap-2 px-4 py-2 text-label text-danger"
        >
          <span aria-hidden className="h-px flex-1 bg-danger" />
          New messages
          <span aria-hidden className="h-px flex-1 bg-danger" />
        </li>
      );
    case 'system':
      return (
        <li
          data-anchor={row.message.id}
          data-testid="messages-system-line"
          className="px-4 py-1 text-center text-small text-muted"
        >
          {row.message.system
            ? systemLineText(row.message.system, nameLookup(context.people))
            : null}
        </li>
      );
    case 'message':
      return <MessageRow message={row.message} first={row.first} context={context} />;
    case 'pending':
      return <PendingRow pending={row.pending} first={row.first} context={context} />;
  }
}
