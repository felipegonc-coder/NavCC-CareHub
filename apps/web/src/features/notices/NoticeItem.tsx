import type { TimePrefs } from '@carehub/team-time';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  VisuallyHidden,
} from '@carehub/ui';
import { ChevronDown, FileText } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import type { NoticeCardView, NoticeView, PageIcon } from './api';
import { closedCardText, noticeIcon, noticeTime } from './chat';
import { useNoticeAction } from './hooks';

export interface NoticeItemProps {
  notice: NoticeView;
  prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>;
  /** The one notice Tab stops at; ↑ and ↓ move between notices from there. */
  tabbable: boolean;
  onFocus: () => void;
  /** A link on the notice was clicked: it counts as read. */
  onOpen: () => void;
}

export function NoticeItem({ notice, prefs, tabbable, onFocus, onOpen }: NoticeItemProps) {
  const id = useId();
  return (
    <article
      data-notice-id={notice.id}
      tabIndex={tabbable ? 0 : -1}
      aria-labelledby={`${id}-sender ${id}-title`}
      onFocus={onFocus}
      className="flex gap-3 rounded px-3 py-2 outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="w-6 shrink-0 text-center text-h3 leading-6">
        {noticeIcon(notice)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
          <span id={`${id}-sender`} className="font-medium text-fg">
            {notice.sender}
          </span>
          <time dateTime={notice.latestAt}>{noticeTime(notice, prefs)}</time>
          {notice.count > 1 && <span>· {notice.count} notices</span>}
          {!notice.read && (
            <>
              <span aria-hidden className="size-2 rounded-full bg-primary" />
              <VisuallyHidden>Unread</VisuallyHidden>
            </>
          )}
        </p>
        <p id={`${id}-title`} className={cn('text-body text-fg', !notice.read && 'font-semibold')}>
          {notice.title}
        </p>
        {notice.text && (
          <p className="whitespace-pre-line break-words text-body text-muted">{notice.text}</p>
        )}
        {notice.card && <NoticeCard card={notice.card} onOpen={onOpen} />}
        {notice.buttons.length > 0 && <NoticeButtons notice={notice} onOpen={onOpen} />}
      </div>
    </article>
  );
}

const cardClasses =
  'mt-2 flex max-w-md items-center gap-2 rounded border border-border px-3 py-2 text-small';

function NoticeCard({ card, onOpen }: { card: NoticeCardView; onOpen: () => void }) {
  if (card.state !== 'open') {
    return <p className={cn(cardClasses, 'text-muted')}>{closedCardText(card)}</p>;
  }
  const linkClasses = cn(
    cardClasses,
    'text-fg outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring',
  );
  if (card.type === 'page') {
    return (
      <Link to={card.href} onClick={onOpen} className={linkClasses}>
        <PageIconView icon={card.icon} />
        <span className="truncate font-medium">{card.title || 'Untitled'}</span>
        {card.spaceName && <span className="truncate text-muted">{card.spaceName}</span>}
      </Link>
    );
  }
  return (
    <Link to={card.href} onClick={onOpen} className={linkClasses}>
      <span aria-hidden>📅</span>
      <span className="truncate font-medium">{card.title || 'Untitled event'}</span>
      {card.when && <span className="shrink-0 text-muted">{card.when}</span>}
    </Link>
  );
}

function PageIconView({ icon }: { icon: PageIcon | null }) {
  if (icon?.type === 'emoji') return <span aria-hidden>{icon.emoji}</span>;
  return <FileText aria-hidden className="size-4 shrink-0 text-muted" />;
}

/** Link and action buttons. An action shows the feature's confirmation, or why it failed. */
function NoticeButtons({ notice, onOpen }: { notice: NoticeView; onOpen: () => void }) {
  const action = useNoticeAction(notice.id);
  const hasActions = notice.buttons.some((button) => button.type === 'action');
  const running = (index: number) => action.isPending && action.variables?.button === index;
  const confirmation = action.isSuccess ? (action.data?.message ?? 'Done.') : '';
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {notice.buttons.map((button, index) => {
          if (button.type === 'link') {
            return (
              <Button key={index} asChild size="sm" variant="secondary">
                <Link to={button.href} onClick={onOpen}>
                  {button.label}
                </Link>
              </Button>
            );
          }
          if (button.choices.length === 0) {
            return (
              <Button
                key={index}
                size="sm"
                variant="secondary"
                loading={running(index)}
                onClick={() => action.mutate({ button: index })}
              >
                {button.label}
              </Button>
            );
          }
          return (
            <DropdownMenu key={index}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" loading={running(index)}>
                  {button.label}
                  <ChevronDown aria-hidden className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {button.choices.map((label, choice) => (
                  <DropdownMenuItem
                    key={choice}
                    onSelect={() => action.mutate({ button: index, choice })}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
      {hasActions && (
        <p role="status" className={cn('text-small text-muted', confirmation && 'mt-1')}>
          {confirmation}
        </p>
      )}
      {action.isError && (
        <p role="alert" className="mt-1 text-small text-danger">
          {action.error?.message ?? 'Something went wrong. Try again.'}
        </p>
      )}
    </>
  );
}
