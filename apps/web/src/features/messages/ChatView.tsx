import { Bell, BellOff, Ellipsis } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  firstUnreadSeq,
  prepareMessage,
  spokenMessage,
  type ChatResponse,
  type HistoryResponse,
  type MessageJson,
} from '@carehub/team-chat';
import {
  Button,
  buttonClasses,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  VisuallyHidden,
} from '@carehub/ui';
import { ApiError } from '../../lib/api';
import {
  firstName,
  nameLookup,
  otherPersonId,
  previewSource,
  senderName,
  titleOf,
  unreadMessage,
} from './chat-info';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import {
  historyOf,
  useChat,
  useDeleteMessage,
  useEditMessage,
  useHistory,
  useMarkRead,
  useMarkUnread,
  useMute,
  useOutbox,
  usePendingMessages,
} from './data';
import { useAfter, useTabVisible } from './hooks';
import { LoadError } from './LoadError';
import { readableText, storedText } from './mentions';
import { MessageList } from './MessageList';
import type { RowContext } from './MessageRow';
import { buildRows } from './rows';

/** Grey message bubbles while a chat loads. */
export function MessagesLoading() {
  const show = useAfter(300);
  return (
    <div
      aria-busy="true"
      className="flex flex-1 flex-col justify-end gap-4 p-4"
      data-testid="messages-chat-loading"
    >
      <VisuallyHidden>Loading messages…</VisuallyHidden>
      {show &&
        ['w-1/2', 'w-2/3', 'w-1/3'].map((width) => (
          <div key={width} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className={cn('h-10', width)} />
            </div>
          </div>
        ))}
    </div>
  );
}

const statusOf = (error: Error) => (error instanceof ApiError ? error.status : null);

/** The open chat: loading, the reason it can't open, or the chat itself. */
export function ChatView({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const history = useHistory(chatId);
  const error = chat.error ?? history.error;

  if (error) {
    const status = statusOf(error);
    if (status === 404 || status === 403) {
      return (
        <>
          <ChatHeader title={status === 404 ? 'Not found' : 'No access'} />
          <p className="p-4 text-muted" data-testid="messages-chat-unavailable">
            {status === 404 ? "This chat doesn't exist." : "You're not in this chat."}
          </p>
        </>
      );
    }
    return (
      <>
        <ChatHeader title="Messages" />
        <LoadError
          message={error.message}
          onRetry={() => {
            void chat.refetch();
            void history.refetch();
          }}
        />
      </>
    );
  }
  if (!chat.data || !history.data) {
    return (
      <>
        <ChatHeader title={<Skeleton className="h-4 w-40" />} />
        <MessagesLoading />
      </>
    );
  }
  return (
    <OpenChat
      chatId={chatId}
      answer={chat.data}
      pages={history.data.pages}
      hasOlder={history.hasNextPage}
      loadingOlder={history.isFetchingNextPage}
      onLoadOlder={() => void history.fetchNextPage()}
      settled={!chat.isFetching && !history.isFetching}
    />
  );
}

interface OpenChatProps {
  chatId: string;
  answer: ChatResponse;
  pages: readonly HistoryResponse[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
  /** Both answers are up to date, so the unread ones are known. */
  settled: boolean;
}

function OpenChat({
  chatId,
  answer,
  pages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  settled,
}: OpenChatProps) {
  const { viewerId, chat } = answer;
  const outbox = useOutbox();
  const pending = usePendingMessages(outbox, chatId);
  const history = useMemo(() => historyOf({ pages }), [pages]);
  const { messages } = history;
  const people = useMemo(
    () => ({ ...history.people, ...answer.people }),
    [history.people, answer.people],
  );
  const nameOf = useMemo(() => nameLookup(people), [people]);
  const memberIds = useMemo(() => chat.members.map((member) => member.userId), [chat.members]);
  const title = titleOf(chat, viewerId, people);
  const otherId = otherPersonId(chat, viewerId);
  const other = otherId ? people[otherId] : undefined;
  const newestSeq = messages.at(-1)?.seq ?? 0;

  // The "New messages" line stays where the first unread message was when the chat opened.
  const [newLine, setNewLine] = useState<number | null | undefined>(undefined);
  if (newLine === undefined && settled) {
    setNewLine(firstUnreadSeq(messages.map(unreadMessage), viewerId, chat.lastReadSeq));
  }
  const ready = newLine !== undefined;
  const rows = useMemo(
    () =>
      buildRows(messages, pending, { viewerId, newMessagesSeq: newLine ?? null, now: new Date() }),
    [messages, pending, viewerId, newLine],
  );

  // Read when the chat is open, the tab is in front and the newest messages are on screen.
  const [atBottom, setAtBottom] = useState(true);
  const [holdRead, setHoldRead] = useState(false);
  const visible = useTabVisible();
  const { mutate: markRead } = useMarkRead(chatId);
  const posted = useRef(0);
  useEffect(() => {
    if (!ready || holdRead || !visible || !atBottom || chat.unread === 0) return;
    if (newestSeq <= chat.lastReadSeq || newestSeq <= posted.current) return;
    posted.current = newestSeq;
    markRead(newestSeq, {
      onError: () => {
        posted.current = 0;
      },
    });
  }, [ready, holdRead, visible, atBottom, chat.unread, chat.lastReadSeq, newestSeq, markRead]);

  // Screen readers hear new messages from others: "Avery Lin: Can you check the QA form?"
  const [status, setStatus] = useState('');
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const since = announced.current;
    announced.current = Math.max(since ?? 0, newestSeq);
    if (since === null) return;
    const latest = messages.findLast(
      (message) =>
        message.seq > since &&
        message.kind === 'message' &&
        message.senderId !== viewerId &&
        !message.deletedAt,
    );
    if (latest) setStatus(spokenMessage(senderName(latest, people), previewSource(latest), nameOf));
  }, [ready, newestSeq, messages, viewerId, people, nameOf]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = () => window.requestAnimationFrame(() => inputRef.current?.focus());
  const [editing, setEditing] = useState<MessageJson | null>(null);
  const edit = useEditMessage(chatId);
  const startEdit = (message: MessageJson) => {
    edit.reset();
    setEditing(message);
    focusComposer();
  };
  const stopEdit = () => {
    edit.reset();
    setEditing(null);
    focusComposer();
  };
  const editLast = () => {
    const last = messages.findLast(
      (message) =>
        message.kind === 'message' && message.senderId === viewerId && !message.deletedAt,
    );
    if (last) startEdit(last);
  };

  const submit = (text: string) => {
    if (!editing) {
      const prepared = prepareMessage({ text }, { memberIds });
      if (prepared.ok) outbox.send(chatId, prepared.message.text);
      return;
    }
    const prepared = prepareMessage(
      { text: storedText(text, editing.mentions, nameOf), pageIds: editing.pageIds },
      { memberIds },
    );
    if (!prepared.ok) return;
    if (prepared.message.text === editing.text) {
      stopEdit();
      return;
    }
    edit.mutate(
      { messageId: editing.id, text: prepared.message.text, pageIds: prepared.message.pageIds },
      { onSuccess: stopEdit },
    );
  };

  const [deleting, setDeleting] = useState<MessageJson | null>(null);
  const remove = useDeleteMessage(chatId);
  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        if (editing?.id === deleting.id) setEditing(null);
        setDeleting(null);
        setStatus('Message deleted.');
      },
    });
  };

  const mute = useMute(chatId);
  const { mutate: markUnread } = useMarkUnread(chatId);
  const fromOthers = messages.some(
    (message) => message.kind === 'message' && message.senderId !== viewerId && !message.deletedAt,
  );

  const context: RowContext = {
    viewerId,
    people,
    editingId: editing?.id ?? null,
    onCopy: (message) => {
      const text = readableText(message.text, message.mentions, nameOf);
      navigator.clipboard.writeText(text).then(
        () => setStatus('Copied the message.'),
        () => setStatus("Couldn't copy the message."),
      );
    },
    onEdit: startEdit,
    onDelete: (message) => {
      remove.reset();
      setDeleting(message);
    },
    onRetry: (clientId) => outbox.retry(clientId),
    onDiscard: (clientId) => outbox.discard(clientId),
  };

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Chat options"
        data-testid="messages-chat-menu"
        className={buttonClasses({ variant: 'ghost', size: 'sm', icon: true })}
      >
        <Ellipsis className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => mute.mutate(!chat.muted)} data-testid="messages-mute">
          {chat.muted ? (
            <Bell className="size-4" aria-hidden />
          ) : (
            <BellOff className="size-4" aria-hidden />
          )}
          {chat.muted ? 'Unmute' : 'Mute'}
        </DropdownMenuItem>
        {fromOthers && (
          <DropdownMenuItem
            data-testid="messages-mark-unread"
            onSelect={() => {
              setHoldRead(true);
              markUnread(undefined, { onSuccess: () => setStatus('Marked as unread.') });
            }}
          >
            Mark as unread
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const hello =
    chat.type === 'direct' && other
      ? `Say hello to ${firstName(other.name)}.`
      : 'Say hello to the group.';

  return (
    <>
      <ChatHeader
        title={title}
        subtitle={
          chat.type === 'group'
            ? `${chat.members.length} people${chat.muted ? ' · Muted' : ''}`
            : chat.muted
              ? 'Muted'
              : null
        }
        menu={menu}
      />
      <MessageList
        rows={rows}
        context={context}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        ready={ready}
        onAtBottomChange={setAtBottom}
        empty={
          <p className="px-4 pt-8 text-center text-muted" data-testid="messages-empty-chat">
            {hello}
          </p>
        }
      />
      {other?.removed ? (
        <p
          className="shrink-0 border-t border-border p-4 text-small text-muted"
          data-testid="messages-cant-send"
        >
          {other.name} is no longer in this workspace, so they can't get new messages.
        </p>
      ) : (
        <Composer
          key={editing?.id ?? 'new'}
          chatId={chatId}
          label={`Message ${title}`}
          inputRef={inputRef}
          editingText={editing ? readableText(editing.text, editing.mentions, nameOf) : null}
          saving={edit.isPending}
          error={edit.error ? `Couldn't save your change. ${edit.error.message}` : null}
          onSubmit={submit}
          onEditLast={editLast}
          onCancelEdit={stopEdit}
        />
      )}
      <div role="status" className="sr-only" data-testid="messages-announcer">
        {status}
      </div>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent
          data-testid="messages-delete-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusComposer();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              Its text is erased for everyone, and "This message was deleted" stays in its place.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <p role="alert" className="text-small text-danger">
              {remove.error.message}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={confirmDelete}
              data-testid="messages-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
