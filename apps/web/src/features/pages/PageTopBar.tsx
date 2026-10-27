// The page's top bar (Pages and blocks, section 2): breadcrumbs, "View only", "Edited 2m ago" and
// ☆ Favorite, in the shell's top bar.
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
} from '@carehub/ui';
import { Star } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ShellHeader } from '../shell';
import { atLeast, pageUrl } from './access';
import type { EntryActions } from './actions';
import type { Crumb, PageDetail } from './api';
import { editedLabel, editedWhen, foldCrumbs } from './page';
import { EntryIcon, titleOf } from './PageTree';

/** The time now, a minute at a time, for labels like "Edited 2m ago". */
function useNow(every = 60_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

export interface PageTopBarProps {
  page: PageDetail;
  actions: EntryActions;
  /** More buttons at the end, such as the page menu. */
  children?: ReactNode;
}

export function PageTopBar({ page, actions, children }: PageTopBarProps) {
  const now = useNow();
  const starred = actions.isFavorite(page.id);
  const { id, kind, title, icon, access, spaceId } = page;
  const self: Crumb = { id, kind, title, icon };
  return (
    <ShellHeader>
      <Breadcrumbs crumbs={[...page.path, self]} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!atLeast(access, 'edit_content') && (
          <span className="rounded bg-fill px-1.5 py-0.5 text-label text-muted">View only</span>
        )}
        {page.edited && (
          <time
            dateTime={page.edited.at}
            title={editedWhen(page.edited)}
            className="text-small text-muted max-md:hidden"
          >
            {editedLabel(page.edited.at, now)}
          </time>
        )}
        <IconButton
          label="Favorite"
          aria-pressed={starred}
          onClick={() => actions.toggleFavorite({ id, kind, title, icon, access, spaceId })}
        >
          <Star aria-hidden className={cn(starred && 'fill-current')} />
        </IconButton>
        {children}
      </div>
    </ShellHeader>
  );
}

/** While the page loads: the top bar's place, in grey. */
export function TopBarSkeleton() {
  return (
    <ShellHeader>
      <Skeleton className="h-4 w-48" />
    </ShellHeader>
  );
}

const STEP_CLASSES = 'flex min-w-0 max-w-48 items-center gap-1 rounded px-1 py-0.5 [&_svg]:size-4';

/** Space › parent pages › page; past 4 steps the middle folds into "…". */
function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { first, folded, last } = foldCrumbs(crumbs);
  const steps: (Crumb | Crumb[])[] = [...first, ...(folded.length > 0 ? [folded] : []), ...last];
  return (
    <nav aria-label="Breadcrumbs" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-0.5 text-small">
        {steps.map((step, index) => (
          <li
            key={Array.isArray(step) ? 'folded' : step.id}
            className="flex min-w-0 items-center gap-0.5"
          >
            {index > 0 && (
              <span aria-hidden className="px-0.5 text-muted">
                ›
              </span>
            )}
            {Array.isArray(step) ? (
              <FoldedSteps crumbs={step} />
            ) : (
              <Step crumb={step} current={index === steps.length - 1} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Step({ crumb, current }: { crumb: Crumb; current: boolean }) {
  const label = (
    <>
      <EntryIcon icon={crumb.icon} kind={crumb.kind} />
      <span className="truncate">{titleOf(crumb)}</span>
    </>
  );
  if (current) {
    return (
      <span aria-current="page" className={cn(STEP_CLASSES, 'text-fg')}>
        {label}
      </span>
    );
  }
  if (crumb.kind === 'space')
    return <span className={cn(STEP_CLASSES, 'text-muted')}>{label}</span>;
  return (
    <Link
      to={pageUrl(crumb.id)}
      className={cn(STEP_CLASSES, 'text-muted hover:bg-fill-hover hover:text-fg')}
    >
      {label}
    </Link>
  );
}

function FoldedSteps({ crumbs }: { crumbs: Crumb[] }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Pages in between"
          className="rounded px-1 py-0.5 text-muted hover:bg-fill-hover hover:text-fg"
        >
          …
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {crumbs.map((crumb) => (
          <DropdownMenuItem key={crumb.id} onSelect={() => void navigate(pageUrl(crumb.id))}>
            <EntryIcon icon={crumb.icon} kind={crumb.kind} />
            {titleOf(crumb)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
