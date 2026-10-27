import {
  TEMPLATE_MESSAGES,
  type TemplateCard,
  type TemplateIcon,
} from '@carehub/extras/templates/gallery';
import { cn } from '@carehub/ui';
import { FileText } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

/** A template's page icon: its emoji, or a page. */
export function TemplateIconView({
  icon,
  className,
}: {
  icon: TemplateIcon | null;
  className?: string;
}) {
  if (icon?.type === 'emoji') {
    return (
      <span aria-hidden className={cn('leading-none', className)}>
        {icon.emoji}
      </span>
    );
  }
  return <FileText aria-hidden className={cn('size-[1em] text-muted', className)} />;
}

export interface TemplateCardViewProps {
  card: TemplateCard;
  /** Phones list the cards as rows, without the big picture. */
  compact: boolean;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  /** The card's "…" menu, when the person may change the template. */
  menu?: ReactNode;
}

/** One card: a picture of the page, the name, a one-line description and who made it. */
export function TemplateCardView({
  card,
  compact,
  onOpen,
  onKeyDown,
  menu,
}: TemplateCardViewProps) {
  const by = TEMPLATE_MESSAGES.byLine(card.by);
  return (
    <li className="relative">
      <button
        type="button"
        data-template-card={card.id}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full overflow-hidden rounded border border-border bg-bg text-left text-fg transition-colors hover:border-border-hover',
          compact ? 'items-center gap-3 p-3 pr-14' : 'h-full flex-col',
        )}
      >
        {compact ? (
          <TemplateIconView icon={card.icon} className="text-h3" />
        ) : (
          <span className="flex h-24 w-full items-center justify-center bg-fill text-title">
            <TemplateIconView icon={card.icon} />
          </span>
        )}
        <span className={cn('flex min-w-0 flex-col gap-1', !compact && 'w-full p-3 pr-12')}>
          <span className="truncate text-body font-medium">{card.name}</span>
          {card.description && (
            <span className="truncate text-small text-muted">{card.description}</span>
          )}
          <span className="text-small text-faint">
            {card.hidden ? `${by} · ${TEMPLATE_MESSAGES.hiddenForEveryone}` : by}
          </span>
        </span>
      </button>
      {menu && (
        <div className={cn('absolute right-2', compact ? 'top-2.5' : 'top-[6.5rem]')}>{menu}</div>
      )}
    </li>
  );
}
