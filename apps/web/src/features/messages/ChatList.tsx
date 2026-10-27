import { Bell, BellOff } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { badgeText, COPY, type ChatJson, type ChatListResponse } from '@carehub/team-chat';
import { Avatar, cn, Skeleton, VisuallyHidden } from '@carehub/ui';
import { useNoticesPreview, useNoticesUnread } from '../notices';
import { CARE_HUB_ID, chatHref, previewOf, titleOf } from './chat-info';
import { useChatList } from './data';
import { listTime } from './format';
import { useAfter } from './hooks';
import { LoadError } from './LoadError';

interface ItemProps {
  href: string;
  title: string;
  preview: string | null;
  /** ISO instant of the latest message. */
  at: string | null;
  unread: number;
  muted: boolean;
  picture: ReactNode;
}

function ChatListItem({ href, title, preview, at, unread, muted, picture }: ItemProps) {
  const badge = badgeText(unread);
  return (
    <li>
      <NavLink
        to={href}
        data-testid="messages-chat-item"
        className={({ isActive }) =>
          cn('flex items-center gap-3 rounded px-3 py-2 hover:bg-fill-hover', isActive && 'bg-fill')
        }
      >
        {picture}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                badge && !muted ? 'font-semibold' : 'font-medium',
              )}
            >
              {title}
            </span>
            {at && (
              <time dateTime={at} className="shrink-0 text-small text-muted">
                {listTime(at, new Date())}
              </time>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-small text-muted">{preview}</span>
            {muted && (
              <>
                <BellOff className="size-4 shrink-0 text-muted" aria-hidden />
                <VisuallyHidden>Muted</VisuallyHidden>
              </>
            )}
            {badge && (
              <span
                data-testid="messages-unread-count"
                className={cn(
                  'shrink-0 rounded-full px-1.5 text-label',
                  muted ? 'bg-fill text-muted' : 'bg-primary text-primary-fg',
                )}
              >
                {badge}
                <VisuallyHidden> unread</VisuallyHidden>
              </span>
            )}
          </span>
        </span>
      </NavLink>
    </li>
  );
}

/** 🔔 Care Hub, always first; the notices feature gives its preview and count. */
export function CareHubItem() {
  const latest = useNoticesPreview();
  const unread = useNoticesUnread();
  return (
    <ChatListItem
      href={chatHref(CARE_HUB_ID)}
      title={COPY.careHubChatName}
      preview={latest ? latest.title : latest === null ? 'No notices yet.' : null}
      at={latest?.latestAt ?? null}
      unread={unread}
      muted={false}
      picture={
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill">
          <Bell className="size-4" aria-hidden />
        </span>
      }
    />
  );
}

/** A chat in the list, or in search results. */
export function ChatItem({ chat, answer }: { chat: ChatJson; answer: ChatListResponse }) {
  const title = titleOf(chat, answer.viewerId, answer.people);
  return (
    <ChatListItem
      href={chatHref(chat.id)}
      title={title}
      preview={
        chat.lastMessage ? previewOf(chat.lastMessage, answer.viewerId, answer.people) : null
      }
      at={chat.lastMessageAt}
      unread={chat.unread}
      muted={chat.muted}
      picture={<Avatar name={title} decorative />}
    />
  );
}

function ListLoading() {
  const show = useAfter(300);
  return (
    <div aria-busy="true" className="flex flex-col gap-1 px-2" data-testid="messages-list-loading">
      <VisuallyHidden>Loading chats…</VisuallyHidden>
      {show &&
        [0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
    </div>
  );
}

interface Stop {
  id: string;
  unread: boolean;
}

/** Alt+↑ and Alt+↓ open the previous or next chat; with Shift, the previous or next unread one. */
function useChatKeys(stops: readonly Stop[], activeId: string | null) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const start = stops.findIndex((stop) => stop.id === activeId);
      for (let index = start === -1 && step < 0 ? stops.length : start; ;) {
        index += step;
        const stop = stops[index];
        if (!stop) return;
        if (event.shiftKey && !stop.unread) continue;
        event.preventDefault();
        void navigate(chatHref(stop.id));
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stops, activeId, navigate]);
}

const stopsOf = (answer: ChatListResponse | null | undefined, noticesUnread: number): Stop[] => [
  { id: CARE_HUB_ID, unread: noticesUnread > 0 },
  ...(answer?.chats ?? []).map((chat) => ({
    id: chat.id,
    unread: (chat.muted ? chat.mentions : chat.unread) > 0,
  })),
];

/** 🔔 Care Hub, then the person's chats by latest message. Kept (hidden) under search results. */
export function ChatList({
  activeId,
  hidden = false,
}: {
  activeId: string | null;
  hidden?: boolean;
}) {
  const list = useChatList();
  const noticesUnread = useNoticesUnread();
  const answer = list.data;
  const stops = useMemo(() => stopsOf(answer, noticesUnread), [answer, noticesUnread]);
  useChatKeys(stops, activeId);

  return (
    <nav aria-label="Chats" className={cn('min-h-0 flex-1 overflow-y-auto', hidden && 'hidden')}>
      <ul className="flex flex-col gap-1 p-2" data-testid="messages-chat-list">
        <CareHubItem />
        {answer?.chats.map((chat) => (
          <ChatItem key={chat.id} chat={chat} answer={answer} />
        ))}
      </ul>
      {list.isPending && <ListLoading />}
      {list.isError && (
        <LoadError message={list.error?.message ?? ''} onRetry={() => void list.refetch()} />
      )}
      {answer?.chats.length === 0 && (
        <p className="px-4 py-2 text-muted" data-testid="messages-no-chats">
          No messages yet. Start a chat with New message.
        </p>
      )}
    </nav>
  );
}
