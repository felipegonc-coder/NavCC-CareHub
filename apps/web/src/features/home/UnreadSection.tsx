import { VisuallyHidden } from '@carehub/ui';
import { Link } from 'react-router';
import { useNoticesPreview, useNoticesUnread, type NoticesPreview } from '../notices';
import { HomeSection, rowClasses, withData, type SectionQuery } from './HomeSection';
import type { SectionProps } from './sections';
import { chatTime } from './time';
import { useUnreadChats, type UnreadChat } from './unread';

const SHOWN = 5;
const countClasses =
  'shrink-0 rounded-full bg-primary px-1.5 text-label font-medium text-primary-fg';

/** The person's 🔔 Care Hub chat, as the Unread messages row shows it. */
export interface CareHubUnread {
  unread: number;
  latest: NoticesPreview | null | undefined;
}

interface UnreadRow {
  key: string;
  icon?: string;
  name: string;
  preview: string;
  count: number;
  /** ISO instant of the latest message. */
  at: string;
  href: string;
}

/** Chats with unread messages, 🔔 Care Hub first (HR-01). */
export function UnreadSection(props: SectionProps) {
  const chats = useUnreadChats(SHOWN);
  const unread = useNoticesUnread();
  const latest = useNoticesPreview();
  return <UnreadList chats={chats} careHub={{ unread, latest }} {...props} />;
}

/** The section itself, given its data: for UnreadSection, and for tests. */
export function UnreadList({
  chats,
  careHub,
  now,
  prefs,
}: SectionProps & { chats: SectionQuery<UnreadChat>; careHub: CareHubUnread }) {
  const rows = chats.data && [...careHubRows(careHub), ...chats.data.map(chatRow)];
  return (
    <HomeSection
      title="Unread messages"
      link={{ label: 'Open Messages', to: '/messages' }}
      query={withData(chats, rows)}
      limit={SHOWN}
      empty="You're all caught up."
      noun="unread messages"
      itemKey={(row) => row.key}
      renderItem={(row) => <UnreadChatRow row={row} now={now} prefs={prefs} />}
    />
  );
}

/** Name, time, the latest message and the unread count, as Messages lists chats. */
function UnreadChatRow({ row, now, prefs }: { row: UnreadRow } & SectionProps) {
  return (
    <Link to={row.href} className={rowClasses}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">
            {row.icon && <span aria-hidden>{`${row.icon} `}</span>}
            {row.name}
          </span>{' '}
          <span className="ml-auto shrink-0 text-label text-muted">
            {chatTime(row.at, now, prefs)}
          </span>
        </span>{' '}
        <span className="truncate text-muted">{row.preview}</span>
      </span>{' '}
      <span className={countClasses}>
        {row.count > 99 ? '99+' : row.count}
        <VisuallyHidden> unread</VisuallyHidden>
      </span>
    </Link>
  );
}

/** The 🔔 row, while the chat has unread notices. */
function careHubRows({ unread, latest }: CareHubUnread): UnreadRow[] {
  if (unread === 0 || !latest) return [];
  return [
    {
      key: 'care-hub',
      icon: '🔔',
      name: 'Care Hub',
      preview: latest.title,
      count: unread,
      at: latest.latestAt,
      href: '/messages/care-hub',
    },
  ];
}

function chatRow(chat: UnreadChat): UnreadRow {
  return {
    key: chat.chatId,
    name: chat.name,
    preview: chat.preview,
    count: chat.unreadCount,
    at: chat.lastMessageAt,
    href: chat.href,
  };
}
