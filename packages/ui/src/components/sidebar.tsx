import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/** One link row in the sidebar; `active` marks the current screen. 44 px tall on phones. */
export function sidebarRowClasses({ active = false }: { active?: boolean } = {}): string {
  return cn(
    'flex h-8 items-center gap-2 rounded px-2 text-small text-muted transition-colors hover:bg-fill-hover hover:text-fg focus-visible:outline-offset-inset max-md:h-11 [&_svg]:size-4 [&_svg]:shrink-0',
    active && 'bg-fill-hover font-medium text-fg',
  );
}

export interface SidebarGroupProps {
  title: string;
  /** Small buttons next to the title, such as "New page". */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A titled block in the sidebar (Upcoming, Favorites, a space), named by its title. */
export function SidebarGroup({ title, actions, className, children }: SidebarGroupProps) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn('flex flex-col gap-1', className)}>
      <div className="flex h-6 items-center justify-between gap-2 px-2">
        <h2 id={titleId} className="truncate text-label font-medium text-muted">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </div>
  );
}
