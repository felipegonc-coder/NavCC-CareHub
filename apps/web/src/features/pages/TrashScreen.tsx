import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
  VisuallyHidden,
} from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { pageUrl } from './access';
import {
  deleteForever,
  fetchTrash,
  pagesKeys,
  parentInTrash,
  restoreFromTrash,
  type TrashItem,
  type TrashList,
} from './api';
import type { MoveTo } from './move';
import { MoveDialog } from './MoveDialog';
import { EntryIcon } from './PageTree';
import {
  ago,
  deletesIn,
  describeItem,
  filterChoices,
  filterTrash,
  insideLabel,
  named,
  NO_FILTERS,
  type TrashFilters,
} from './trash';
import type { TreeNode } from './types';

const KINDS = [
  ['', 'All types'],
  ['page', 'Pages'],
  ['database', 'Databases'],
  ['row', 'Rows'],
] as const;

/** The filters' "everything" choice (a select's options can't have an empty value). */
const ALL = '*';

/** A restore the server refused because the place it came from is in Trash too. */
interface ParentAsk {
  item: TrashItem;
  parent: { id: string; title: string };
}

const toggled = (ids: readonly string[], on: boolean) => (current: ReadonlySet<string>) => {
  const next = new Set(current);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
};

/** "Move to…" lists places for a page; an item in Trash stands in for one. */
const asPage = (item: TrashItem): TreeNode => ({
  id: item.id,
  parentId: null,
  kind: item.kind === 'database' ? 'database' : 'page',
  title: item.title,
  icon: item.icon,
  position: '',
  hasChildren: item.inside > 0,
  access: 'full',
});

/** What the person deleted, or could open fully, to restore or delete forever. */
export function TrashScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const trash = useQuery({ queryKey: pagesKeys.trash, queryFn: fetchTrash });
  const [now] = useState(Date.now);
  const [filters, setFilters] = useState<TrashFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<TrashItem[] | null>(null);
  const [asking, setAsking] = useState<ParentAsk | null>(null);
  const [placing, setPlacing] = useState<TrashItem | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => search.current?.focus(), []);

  const items = trash.data?.items ?? [];
  const shown = filterTrash(items, filters);
  const choices = filterChoices(items);
  const picked = shown.filter((item) => selected.has(item.id));
  const filter = (patch: Partial<TrashFilters>) => setFilters((old) => ({ ...old, ...patch }));

  /** Takes items out of the list now that the server has them out of Trash. */
  const remove = (ids: readonly string[]) => {
    queryClient.setQueryData<TrashList>(pagesKeys.trash, (data) =>
      data ? { ...data, items: data.items.filter((item) => !ids.includes(item.id)) } : data,
    );
    setSelected(toggled(ids, false));
  };

  async function restore(item: TrashItem, to?: MoveTo, alone = true) {
    setRestoring(toggled([item.id], true));
    try {
      await restoreFromTrash(item.id, to);
      remove([item.id]);
      void queryClient.invalidateQueries({ queryKey: pagesKeys.all });
    } catch (error) {
      const parent = alone ? parentInTrash(error) : null;
      if (parent) setAsking({ item, parent });
      else toast({ title: `Couldn't restore ${named(item)}. Try again.`, variant: 'danger' });
    } finally {
      setRestoring(toggled([item.id], false));
    }
  }

  async function restoreBoth({ item, parent }: ParentAsk) {
    setAsking(null);
    try {
      await restoreFromTrash(parent.id);
      remove([parent.id]);
    } catch {
      toast({ title: `Couldn't restore ${named(parent)}. Try again.`, variant: 'danger' });
      return;
    }
    await restore(item);
  }

  async function deleteAll(group: readonly TrashItem[]) {
    setDeleting(null);
    remove(group.map((item) => item.id));
    const results = await Promise.allSettled(group.map((item) => deleteForever(item.id)));
    group.forEach((item, index) => {
      if (results[index]?.status !== 'rejected') return;
      toast({ title: `Couldn't delete ${named(item)}. Try again.`, variant: 'danger' });
    });
    void queryClient.invalidateQueries({ queryKey: pagesKeys.trash });
  }

  /** ↑ and ↓ between items; ↑ from the first goes back to the search. */
  const step = (from: HTMLElement | null, by: 1 | -1) => {
    const links = [...(list.current?.querySelectorAll<HTMLElement>('[data-trash-item]') ?? [])];
    const at = from ? links.indexOf(from) : -1;
    (at + by < 0 && from ? search.current : links[at + by])?.focus();
  };

  let body: ReactNode;
  if (trash.isError) {
    body = (
      <p className="flex items-center gap-2 text-muted">
        Couldn&apos;t load Trash.
        <Button variant="secondary" size="sm" onClick={() => void trash.refetch()}>
          Retry
        </Button>
      </p>
    );
  } else if (!trash.data) {
    body = <Loading />;
  } else if (items.length === 0) {
    body = (
      <p className="text-muted">
        Trash is empty. Deleted pages stay here for {trash.data.retentionDays} days.
      </p>
    );
  } else if (shown.length === 0) {
    body = (
      <p className="flex items-center gap-3 text-muted">
        Nothing in Trash matches.
        <Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>
          Clear filters
        </Button>
      </p>
    );
  } else {
    body = (
      <ul ref={list} aria-label="In Trash" className="flex flex-col">
        {shown.map((item) => (
          <TrashEntry
            key={item.id}
            item={item}
            now={now}
            selected={selected.has(item.id)}
            restoring={restoring.has(item.id)}
            onSelect={(on) => setSelected(toggled([item.id], on))}
            onRestore={() => void restore(item)}
            onDelete={() => setDeleting([item])}
            onStep={step}
          />
        ))}
      </ul>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-4 px-6 py-8 max-md:px-4 max-md:py-4">
      <title>Care Hub · Trash</title>
      <h1 className="text-title">Trash</h1>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          ref={search}
          type="search"
          aria-label="Search Trash"
          placeholder="Search Trash"
          value={filters.query}
          onChange={(event) => filter({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            step(null, 1);
          }}
          className="min-w-48 flex-1"
        />
        <Filter
          label="Deleted by"
          value={filters.deletedBy}
          options={[['', 'Deleted by anyone'], ...choices.people]}
          onChange={(deletedBy) => filter({ deletedBy })}
        />
        <Filter
          label="In space"
          value={filters.space}
          options={[['', 'In any space'], ...choices.spaces.map((name) => [name, name] as const)]}
          onChange={(space) => filter({ space })}
        />
        <Filter
          label="Type"
          value={filters.kind}
          options={KINDS}
          onChange={(kind) => filter({ kind: kind as TrashFilters['kind'] })}
        />
      </div>
      {picked.length > 0 && (
        <div role="group" aria-label="Selected" className="flex items-center gap-2 text-small">
          <span className="mr-auto">{picked.length} selected</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void Promise.all(picked.map((item) => restore(item, undefined, false)))}
          >
            Restore
          </Button>
          {picked.every((item) => item.canDelete) && (
            <Button variant="danger" size="sm" onClick={() => setDeleting(picked)}>
              Delete forever
            </Button>
          )}
        </div>
      )}
      {body}
      {deleting && (
        <DeleteDialog
          items={deleting}
          onDone={(ok) => (ok ? void deleteAll(deleting) : setDeleting(null))}
        />
      )}
      {asking && (
        <ParentDialog
          ask={asking}
          onRestoreBoth={() => void restoreBoth(asking)}
          onMove={() => {
            setAsking(null);
            setPlacing(asking.item);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {placing && (
        <MoveDialog
          page={asPage(placing)}
          onClose={() => setPlacing(null)}
          onMove={(to) => {
            setPlacing(null);
            void restore(placing, to);
          }}
        />
      )}
    </main>
  );
}

interface EntryProps {
  item: TrashItem;
  now: number;
  selected: boolean;
  restoring: boolean;
  onSelect(on: boolean): void;
  onRestore(): void;
  onDelete(): void;
  onStep(from: HTMLElement, by: 1 | -1): void;
}

/** Icon, title, where it was, who deleted it and when, and when it goes for good. */
function TrashEntry({ item, now, selected, restoring, ...on }: EntryProps) {
  const deletes = deletesIn(item, now);
  const by = item.deletedBy ? ` by ${item.deletedBy.name}` : '';
  const details = [item.path.join(' › '), `Deleted${by} ${ago(item.deletedAt, now)}`];
  const content = (
    <>
      <EntryIcon icon={item.icon} kind={item.kind} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          <span className="font-medium">{named(item)}</span>
          {item.inside > 0 && <span className="text-muted"> {insideLabel(item.inside)}</span>}
        </span>
        <span className="truncate text-small text-muted">
          {details.filter(Boolean).join(' · ')}
        </span>
      </span>
    </>
  );
  const main = 'flex min-w-0 flex-1 basis-60 items-center gap-2 rounded py-1';
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    on.onStep(event.currentTarget, step);
  };
  return (
    <li
      aria-busy={restoring || undefined}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 transition-opacity',
        restoring && 'opacity-50',
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(state) => on.onSelect(state === true)}
        aria-label={`Select ${named(item)}`}
      />
      {item.kind === 'space' ? (
        <span className={main}>{content}</span>
      ) : (
        <Link
          to={pageUrl(item.id)}
          data-trash-item
          aria-label={describeItem(item, now)}
          onKeyDown={onKeyDown}
          className={main}
        >
          {content}
        </Link>
      )}
      <span className={cn('text-small', deletes.soon ? 'text-danger' : 'text-muted')}>
        {restoring ? 'Restoring…' : deletes.label}
      </span>
      <span className="flex gap-1">
        <Button variant="secondary" size="sm" disabled={restoring} onClick={on.onRestore}>
          Restore
        </Button>
        {item.canDelete && (
          <Button variant="ghost" size="sm" disabled={restoring} onClick={on.onDelete}>
            Delete forever
          </Button>
        )}
      </span>
    </li>
  );
}

interface FilterProps {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange(value: string): void;
}

/** One of Trash's filters; the first option, with an empty value, shows everything. */
function Filter({ label, value, options, onChange }: FilterProps) {
  return (
    <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
      <SelectTrigger aria-label={label} className="w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, text]) => (
          <SelectItem key={option || ALL} value={option || ALL}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeleteDialog({ items, onDone }: { items: TrashItem[]; onDone(ok: boolean): void }) {
  const [only] = items;
  const what =
    items.length === 1 && only
      ? [named(only), insideLabel(only.inside)].filter(Boolean).join(' ')
      : `${items.length} items`;
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {what} forever?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onDone(true)}>
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ParentDialogProps {
  ask: ParentAsk;
  onRestoreBoth(): void;
  onMove(): void;
  onCancel(): void;
}

/** "Policies is in Trash too. Restore it as well, or move Refund steps somewhere else?" */
function ParentDialog({ ask, onRestoreBoth, onMove, onCancel }: ParentDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{named(ask.parent)} is in Trash too</DialogTitle>
          <DialogDescription>
            Restore it as well, or move {named(ask.item)} somewhere else?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {ask.item.kind !== 'row' && (
            <Button variant="secondary" onClick={onMove}>
              Move to…
            </Button>
          )}
          <Button onClick={onRestoreBoth}>Restore both</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <VisuallyHidden role="status">Loading Trash</VisuallyHidden>
      {['w-2/3', 'w-1/2', 'w-3/5'].map((width) => (
        <Skeleton key={width} className={cn('h-10', width)} />
      ))}
    </div>
  );
}
