import {
  buttonClasses,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  sidebarRowClasses,
} from '@carehub/ui';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import type { MoveHost } from './actions';
import { fetchSpaces, fetchTree, pagesKeys, type AccessChange } from './api';
import { movePlaces, type MoveTo } from './move';
import { EntryIcon, titleOf } from './PageTree';
import type { TreeNode } from './types';

/** "Move to" lists this many places; typing finds the rest. */
const MAX_SHOWN = 50;

interface Asking {
  page: TreeNode;
  change: AccessChange;
  resolve(ok: boolean): void;
}

/**
 * "Move to" and the access-change confirm, for a screen that moves pages: pass `host` to
 * `useEntryActions` and show `dialogs(actions.move)`.
 */
export function useMoveDialogs() {
  const [choosing, setChoosing] = useState<TreeNode | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const host = useMemo<MoveHost>(
    () => ({
      chooseMove: (page) => setChoosing(page),
      confirmMove: (page, change) =>
        new Promise<boolean>((resolve) => setAsking({ page, change, resolve })),
    }),
    [],
  );
  const dialogs = (move: (page: TreeNode, to: MoveTo) => void): ReactNode => (
    <>
      {choosing && (
        <MoveDialog
          page={choosing}
          onClose={() => setChoosing(null)}
          onMove={(to) => {
            setChoosing(null);
            move(choosing, to);
          }}
        />
      )}
      {asking && (
        <AccessChangeDialog
          page={asking.page}
          change={asking.change}
          onDone={(ok) => {
            setAsking(null);
            asking.resolve(ok);
          }}
        />
      )}
    </>
  );
  return { host, dialogs };
}

const dataOf = (results: UseQueryResult<TreeNode[]>[]) => results.map((result) => result.data);

interface MoveDialogProps {
  page: TreeNode;
  onMove(to: MoveTo): void;
  onClose(): void;
}

/** Pick a space or a page to move the page into (Sidebar spec, section 3.2). */
export function MoveDialog({ page, onMove, onClose }: MoveDialogProps) {
  const [query, setQuery] = useState('');
  const spaces = useQuery({ queryKey: pagesKeys.spaces, queryFn: fetchSpaces });
  const trees = useQueries({
    queries: (spaces.data ?? []).map((space) => ({
      queryKey: pagesKeys.tree(space.id),
      queryFn: () => fetchTree(space.id),
    })),
    combine: dataOf,
  });
  const places = useMemo(() => {
    const list = spaces.data ?? [];
    const loaded = new Map<string, TreeNode[]>();
    list.forEach((space, index) => {
      const nodes = trees[index];
      if (nodes) loaded.set(space.id, nodes);
    });
    return movePlaces(page, list, loaded);
  }, [page, spaces.data, trees]);
  const needle = query.trim().toLowerCase();
  const matches = (
    needle ? places.filter((place) => place.title.toLowerCase().includes(needle)) : places
  ).slice(0, MAX_SHOWN);
  const loading = !spaces.data || trees.some((nodes) => nodes === undefined);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md gap-3" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Move “{titleOf(page)}” to</DialogTitle>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Find a page or space"
          placeholder="Find a page or space"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = matches[0];
            if (event.key !== 'Enter' || !first) return;
            event.preventDefault();
            onMove(first.to);
          }}
        />
        <ul aria-label="Places" className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
          {matches.map((place) => (
            <li key={place.key}>
              <button
                type="button"
                onClick={() => onMove(place.to)}
                className={cn(sidebarRowClasses(), 'h-auto min-h-8 w-full py-1 text-left')}
              >
                <EntryIcon icon={place.icon} kind={place.kind} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-fg">{place.title}</span>
                  {place.path && (
                    <span className="truncate text-label text-faint">{place.path}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {matches.length === 0 && (
          <p className="text-small text-muted">
            {loading ? 'Loading places…' : 'No pages or spaces match.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AccessChangeDialogProps {
  page: TreeNode;
  change: AccessChange;
  onDone(ok: boolean): void;
}

/** Shown before a move that changes who can open the page (Roles and permissions). */
function AccessChangeDialog({ page, change, onDone }: AccessChangeDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change who can open “{titleOf(page)}”?</DialogTitle>
          <DialogDescription>
            In its new place, the page and its sub-pages take that place’s access.
          </DialogDescription>
        </DialogHeader>
        <People label="Will lose access" names={change.losing} />
        <People label="Will get access" names={change.gaining} />
        <DialogFooter>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => onDone(false)}
          >
            Cancel
          </button>
          <button type="button" className={buttonClasses()} onClick={() => onDone(true)}>
            Move
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function People({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 5);
  const more = names.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-label font-medium text-muted">{label}</h3>
      <p className="text-small">
        {shown.join(', ')}
        {more > 0 && ` and ${more} more`}
      </p>
    </div>
  );
}
