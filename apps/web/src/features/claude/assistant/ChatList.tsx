// The person's own chats in the assistant panel (Claude features spec, section 3.3), last used
// first: open one, rename it, or delete it for good.
import {
  CHAT_TITLE_MAX,
  type AssistantChat,
  type ChatListResponse,
  type ChatResponse,
} from '@carehub/extras/claude/assistant';
import {
  Button,
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
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
} from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../../lib/api';
import { chatKey, chatsKey, deleteChat, listChats, renameChat } from './api';

export const NO_CHATS = 'No chats yet. Ask a question to start one.';
const SOMETHING_WRONG = 'Something went wrong. Try again.';

const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : day.format(date);
};
const problemText = (error: unknown) =>
  error instanceof ApiError ? error.message : SOMETHING_WRONG;

type Editing = { kind: 'rename' | 'delete'; chat: AssistantChat } | null;

export interface ChatListProps {
  person: string;
  /** The chat on show in the conversation. */
  current: string | null;
  onOpen: (chatId: string) => void;
  /** A chat was deleted. */
  onDeleted: (chatId: string) => void;
  /** The last chat was deleted: there's no row left to go back to. */
  onNoRows: () => void;
}

export function ChatList({ person, current, onOpen, onDeleted, onNoRows }: ChatListProps) {
  const query = useQuery({
    queryKey: chatsKey(person),
    queryFn: ({ signal }) => listChats(signal),
  });
  const [editing, setEditing] = useState<Editing>(null);
  const list = useRef<HTMLUListElement>(null);
  /** A menu item opened a dialog: the menu leaves focus to the dialog. */
  const toDialog = useRef(false);
  /** The chat whose "…" button gets focus back when the dialog closes. */
  const backTo = useRef<string | null>(null);

  const edit = (kind: 'rename' | 'delete', chat: AssistantChat) => {
    toDialog.current = true;
    backTo.current = chat.id;
    setEditing({ kind, chat });
  };

  const refocus = (event: Event) => {
    event.preventDefault();
    const row = list.current?.querySelector<HTMLElement>(`[data-chat="${backTo.current ?? ''}"]`);
    const next = row ?? list.current?.querySelector<HTMLElement>('button');
    if (next) next.focus();
    else onNoRows();
  };

  if (query.isPending) return <LoadingState label="Loading chats" className="p-4" />;
  if (query.isError) {
    return (
      <ErrorState
        message="Couldn't load your chats."
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const { chats } = query.data;

  return (
    <>
      {chats.length === 0 ? (
        <EmptyState message={NO_CHATS} />
      ) : (
        <ul ref={list} aria-label="Your chats" className="flex flex-col gap-0.5 p-2">
          {chats.map((chat) => (
            <li key={chat.id} className="flex items-center gap-1 rounded hover:bg-fill-hover">
              <button
                type="button"
                aria-current={chat.id === current ? 'true' : undefined}
                onClick={() => onOpen(chat.id)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-left text-small focus-visible:outline-offset-inset',
                  chat.id === current && 'font-medium',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="shrink-0 text-label text-muted">{when(chat.updatedAt)}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More for ${chat.title}`} size="sm" data-chat={chat.id}>
                    <Ellipsis aria-hidden />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (!toDialog.current) return;
                    toDialog.current = false;
                    event.preventDefault();
                  }}
                >
                  <DropdownMenuItem onSelect={() => edit('rename', chat)}>
                    <Pencil aria-hidden />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="danger" onSelect={() => edit('delete', chat)}>
                    <Trash2 aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent onCloseAutoFocus={refocus}>
          {editing?.kind === 'rename' && (
            <RenameChat person={person} chat={editing.chat} onDone={() => setEditing(null)} />
          )}
          {editing?.kind === 'delete' && (
            <DeleteChat
              person={person}
              chat={editing.chat}
              onDone={() => {
                onDeleted(editing.chat.id);
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface EditProps {
  person: string;
  chat: AssistantChat;
  onDone: () => void;
}

function RenameChat({ person, chat, onDone }: EditProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(chat.title);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) {
      setError('Type a name.');
      return;
    }
    setSaving(true);
    try {
      const renamed = await renameChat(chat.id, name);
      queryClient.setQueryData<ChatListResponse>(chatsKey(person), (list) =>
        list ? { chats: list.chats.map((one) => (one.id === renamed.id ? renamed : one)) } : list,
      );
      queryClient.setQueryData<ChatResponse>(chatKey(person, renamed.id), (open) =>
        open ? { ...open, chat: renamed } : open,
      );
      onDone();
    } catch (failure) {
      setError(problemText(failure));
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
        <DialogDescription>Only you see your chats.</DialogDescription>
      </DialogHeader>
      <Field label="Name" error={error}>
        <Input
          value={title}
          maxLength={CHAT_TITLE_MAX}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(undefined);
          }}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteChat({ person, chat, onDone }: EditProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteChat(chat.id);
      queryClient.removeQueries({ queryKey: chatKey(person, chat.id), exact: true });
      queryClient.setQueryData<ChatListResponse>(chatsKey(person), (list) =>
        list ? { chats: list.chats.filter((one) => one.id !== chat.id) } : list,
      );
      onDone();
    } catch (failure) {
      setError(problemText(failure));
      setDeleting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete this chat?</DialogTitle>
        <DialogDescription>
          “{chat.title}” and its answers are deleted for good. This can’t be undone.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button variant="danger" loading={deleting} onClick={() => void remove()}>
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}
