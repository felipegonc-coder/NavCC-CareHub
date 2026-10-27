import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonClasses } from '@carehub/ui';
import { MESSAGES_PATH } from './chat-info';

/** The open chat's name, Back on phones (where the list is its own screen), and its menu. */
export function ChatHeader({
  title,
  subtitle,
  menu,
}: {
  title: ReactNode;
  subtitle?: string | null;
  menu?: ReactNode;
}) {
  return (
    <header
      className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4"
      data-testid="messages-chat-header"
    >
      <Link
        to={MESSAGES_PATH}
        aria-label="Back to chats"
        className={buttonClasses({
          variant: 'ghost',
          size: 'sm',
          icon: true,
          className: 'md:hidden',
        })}
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-h3" data-testid="messages-chat-title">
          {title}
        </h2>
        {subtitle && <p className="truncate text-small text-muted">{subtitle}</p>}
      </div>
      {menu}
    </header>
  );
}
