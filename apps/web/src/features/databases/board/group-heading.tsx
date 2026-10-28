import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OptionColor } from '@carehub/databases';
import { cn, colorClasses } from '@carehub/ui';
import type { QueryGroup } from '../contract';

/** A group's label in its option colour. */
export const chipClasses = (color: OptionColor | undefined) =>
  cn(
    'min-w-0 truncate rounded-sm px-1.5 text-small font-medium',
    color ? cn(colorClasses[color].bg, colorClasses[color].text) : 'text-fg',
  );

/** A group's heading in a list or a gallery: it collapses the group, then its label and count. */
export function GroupHeading({
  group,
  collapsed,
  onToggle,
}: {
  group: QueryGroup;
  collapsed: boolean;
  onToggle(): void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex min-h-8 min-w-0 max-w-full items-center gap-2 self-start rounded px-1 text-small hover:bg-fill-hover max-md:min-h-11"
    >
      <Chevron aria-hidden className="size-4 shrink-0 text-muted" />
      <span className={chipClasses(group.color)}>{group.label}</span>
      <span className="shrink-0 text-muted">{group.count}</span>
    </button>
  );
}
