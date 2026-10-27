// Browse spaces (Sidebar spec, section 2): every Open and Closed space in the workspace, with its
// description and members, to join or to ask to join. A joined space shows in the sidebar at once.
import { Button, cn, Input, Skeleton, useToast, VisuallyHidden } from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { refreshPageData } from './actions';
import { fetchBrowseSpaces, joinSpace, pagesKeys } from './api';
import { reasonOf } from './change';
import { usePermission } from './me';
import { EntryIcon } from './PageTree';
import { SPACE_KINDS } from './SpaceDialogs';
import { CreateSpaceButton } from './SpaceMenu';
import type { BrowseSpace } from './types';

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** Spaces with every typed word in their name or description, in any case. */
function findSpaces(spaces: readonly BrowseSpace[], query: string): readonly BrowseSpace[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return spaces.filter((space) => {
    const text = `${space.name} ${space.description ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function BrowseSpacesScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canCreate = usePermission('pages.create');
  const browse = useQuery({ queryKey: pagesKeys.browse, queryFn: fetchBrowseSpaces });
  const [query, setQuery] = useState('');
  const [joining, setJoining] = useState<ReadonlySet<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);

  const join = async (space: BrowseSpace) => {
    setJoining((ids) => new Set(ids).add(space.id));
    try {
      const membership = await joinSpace(space.id);
      queryClient.setQueryData<BrowseSpace[]>(pagesKeys.browse, (list) =>
        list?.map((item) => (item.id === space.id ? { ...item, membership } : item)),
      );
      void refreshPageData(queryClient);
      toast(
        membership === 'member'
          ? { title: `Joined “${space.name}”.`, description: 'Its pages are in your sidebar.' }
          : {
              title: `Asked to join “${space.name}”.`,
              description: 'Its owners will get a notice.',
            },
      );
    } catch (error) {
      const title = `Couldn't join “${space.name}”.`;
      toast({ title, description: reasonOf(error), variant: 'danger' });
    } finally {
      setJoining((ids) => new Set([...ids].filter((id) => id !== space.id)));
    }
  };

  const spaces = browse.data ?? [];
  const shown = findSpaces(spaces, query);
  let body: ReactNode;
  if (browse.isError) {
    body = (
      <p className="flex items-center gap-2 text-muted">
        Couldn&apos;t load the spaces.
        <Button variant="secondary" size="sm" onClick={() => void browse.refetch()}>
          Retry
        </Button>
      </p>
    );
  } else if (!browse.data) {
    body = <Loading />;
  } else if (spaces.length === 0) {
    body = <p className="text-muted">There are no Open or Closed spaces yet.</p>;
  } else if (shown.length === 0) {
    body = (
      <p className="flex items-center gap-3 text-muted">
        No spaces match “{query.trim()}”.
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setQuery('');
            search.current?.focus();
          }}
        >
          Clear
        </Button>
      </p>
    );
  } else {
    body = (
      <ul aria-label="Spaces" className="flex flex-col">
        {shown.map((space) => (
          <SpaceEntry
            key={space.id}
            space={space}
            joining={joining.has(space.id)}
            onJoin={() => void join(space)}
          />
        ))}
      </ul>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-4 px-6 py-8 max-md:px-4 max-md:py-4">
      <title>Care Hub · Browse spaces</title>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-title">Browse spaces</h1>
        {canCreate && <CreateSpaceButton named />}
      </div>
      <p className="text-muted">
        Anyone can join an Open space; a Closed space&apos;s owners approve who joins.
      </p>
      <Input
        ref={search}
        type="search"
        aria-label="Find a space"
        placeholder="Find a space"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <VisuallyHidden role="status">
        {browse.data && query.trim() ? `${plural(shown.length, 'space')} found` : ''}
      </VisuallyHidden>
      {body}
    </main>
  );
}

interface EntryProps {
  space: BrowseSpace;
  joining: boolean;
  onJoin(): void;
}

/** What the button says, and its whole name for screen readers. */
function joinLabels(space: BrowseSpace): { text: string; label: string } {
  if (space.membership === 'member') return { text: 'Joined', label: `Joined ${space.name}` };
  if (space.membership === 'requested') {
    return { text: 'Requested', label: `Requested to join ${space.name}` };
  }
  const text = space.kind === 'open' ? 'Join' : 'Request to join';
  return { text, label: `${text} ${space.name}` };
}

/** Icon, name, description, kind and members, then Join, Request to join, or where it stands. */
function SpaceEntry({ space, joining, onJoin }: EntryProps) {
  const kind = SPACE_KINDS.find((choice) => choice.value === space.kind)?.label ?? space.kind;
  const count = space.memberCount;
  const done = space.membership !== null;
  const { text, label } = joinLabels(space);
  return (
    <li className="flex items-start gap-3 border-b border-border py-3">
      <EntryIcon icon={space.icon} kind="space" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{space.name}</span>
        {space.description && <span className="text-small text-muted">{space.description}</span>}
        <span className="text-small text-muted">
          {typeof count === 'number' ? `${kind} · ${plural(count, 'member')}` : kind}
        </span>
      </div>
      {/* One button throughout, so focus stays on it once the person has joined. */}
      <Button
        variant={done ? 'ghost' : 'secondary'}
        size="sm"
        loading={joining}
        aria-label={label}
        aria-disabled={done || joining || undefined}
        onClick={done ? undefined : onJoin}
        className={cn(done && 'cursor-default text-muted hover:bg-transparent')}
      >
        {space.membership === 'member' && <Check aria-hidden />}
        {text}
      </Button>
    </li>
  );
}

/** Grey bars, only once loading has taken 300 ms. */
function Loading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return null;
  return (
    <div className="flex flex-col gap-3">
      <VisuallyHidden role="status">Loading spaces</VisuallyHidden>
      {['w-2/3', 'w-1/2', 'w-3/5'].map((width) => (
        <Skeleton key={width} className={cn('h-12', width)} />
      ))}
    </div>
  );
}
