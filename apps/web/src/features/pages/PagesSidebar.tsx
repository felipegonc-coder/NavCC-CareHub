import { atLeast, pageUrl } from '@carehub/shared';
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  SidebarGroup,
  Skeleton,
  sidebarRowClasses,
  VisuallyHidden,
} from '@carehub/ui';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { slots } from '../../slots';
import { useEntryActions, type EntryActions } from './actions';
import {
  clearRecent,
  fetchFavorites,
  fetchRecent,
  fetchShared,
  fetchSpaces,
  fetchTree,
  pagesKeys,
} from './api';
import { useDropZone } from './drag';
import type { MoveScope } from './move';
import { useMoveDialogs } from './MoveDialog';
import { EntryIcon, PageTree, titleOf } from './PageTree';
import { useFlagPref, useSetPref } from './prefs';
import { CreateSpaceButton, SpaceMenu } from './SpaceMenu';
import { groupChildren } from './tree';
import type { PageLink, Space, TreeNode } from './types';

const DatabaseViews = slots.treeItemChildren.database;
const renderViews = DatabaseViews ? (page: TreeNode) => <DatabaseViews page={page} /> : undefined;

/** What every section needs: the person's sidebar settings and the entry actions. */
interface Ctx {
  expanded: ReadonlySet<string>;
  onExpand(keys: readonly string[], open: boolean): void;
  collapsed: ReadonlySet<string>;
  onCollapse(keys: readonly string[], collapsed: boolean): void;
  showRecent: boolean;
  onShowRecent(on: boolean): void;
  actions: EntryActions;
}

/** Favorites, Spaces, Shared, Private and Recent (Sidebar spec, section 2). */
export default function PagesSidebar() {
  const spaces = useQuery({ queryKey: pagesKeys.spaces, queryFn: fetchSpaces });
  const [expanded, onExpand] = useSetPref('sidebar.expanded');
  const [collapsed, onCollapse] = useSetPref('sidebar.collapsed');
  const [showRecent, onShowRecent] = useFlagPref('sidebar.recent', false);
  const moves = useMoveDialogs();
  const actions = useEntryActions(moves.host);
  const ctx: Ctx = { expanded, onExpand, collapsed, onCollapse, showRecent, onShowRecent, actions };

  if (spaces.isError) return <Retry onRetry={() => void spaces.refetch()} />;
  if (!spaces.data) return <Loading />;
  const personal = spaces.data.find((space) => space.kind === 'personal');
  const team = spaces.data.filter((space) => space.kind !== 'personal');
  return (
    <div className="flex flex-col gap-4">
      <Favorites ctx={ctx} spaces={spaces.data} />
      {(team.length > 0 || actions.canCreate) && (
        <Section
          id="spaces"
          title="Spaces"
          ctx={ctx}
          add={actions.canCreate && <CreateSpaceButton />}
        >
          {team.map((space) => (
            <SpaceTree key={space.id} space={space} ctx={ctx} />
          ))}
          {team.length === 0 && (
            <p className="py-1 pl-2 text-small text-muted">Spaces you join show here.</p>
          )}
        </Section>
      )}
      <Shared ctx={ctx} />
      {personal && <Private space={personal} ctx={ctx} />}
      {showRecent && <Recent ctx={ctx} />}
      {moves.dialogs(actions.move)}
    </div>
  );
}

interface SectionProps {
  id: string;
  title: string;
  ctx: Ctx;
  /** A "+" next to the "…". */
  add?: ReactNode;
  /** Items for the heading's menu, above "Show Recent". */
  menu?: ReactNode;
  /** Takes entries dragged onto the section. */
  drop?: ReturnType<typeof useDropZone> | undefined;
  children: ReactNode;
}

/** Whether a mouse event happened on the section's heading, not on its buttons or entries. */
const onHeading = (event: MouseEvent) =>
  event.target instanceof Element && event.target.closest('h2') !== null;

/**
 * A titled block (the kit's sidebar group). Its heading opens and closes it, as does the arrow
 * that keyboards reach; right-clicking the heading opens its options.
 */
function Section({ id, title, ctx, add, menu, drop, children }: SectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const open = !ctx.collapsed.has(id);
  const toggle = () => ctx.onCollapse([id], open);
  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (onHeading(event)) toggle();
      }}
      onContextMenu={(event) => {
        if (!onHeading(event)) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        'rounded [&_h2:hover]:text-fg [&_h2]:cursor-pointer',
        drop?.over && 'ring-2 ring-inset ring-primary',
      )}
      {...drop?.zone}
    >
      <SidebarGroup
        title={title}
        actions={
          <span className="flex items-center md:opacity-0 md:focus-within:opacity-100 md:[div:hover>&]:opacity-100">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton label={`${title} options`} size="sm" className="size-6">
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {menu}
                <DropdownMenuCheckboxItem
                  checked={ctx.showRecent}
                  onCheckedChange={(on: boolean) => ctx.onShowRecent(on)}
                >
                  Show Recent
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {add}
            <IconButton
              label={title}
              aria-expanded={open}
              size="sm"
              className="size-6"
              onClick={toggle}
            >
              <ChevronRight
                aria-hidden
                className={cn('transition-transform', open && 'rotate-90')}
              />
            </IconButton>
          </span>
        }
      >
        {open && children}
      </SidebarGroup>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <IconButton label={label} size="sm" className="size-6" onClick={onClick}>
      <Plus aria-hidden />
    </IconButton>
  );
}

interface TreeBodyProps {
  query: UseQueryResult<TreeNode[]>;
  label: string;
  scope: string;
  ctx: Ctx;
  /** Shown instead of "No pages inside" when there are no pages. */
  empty?: ReactNode;
  moves?: MoveScope | undefined;
}

function TreeBody({ query, label, scope, ctx, empty, moves }: TreeBodyProps) {
  const byParent = useMemo(() => groupChildren(query.data ?? []), [query.data]);
  if (query.isError) return <Retry onRetry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  if (query.data.length === 0) {
    return empty ?? <p className="py-1 pl-8 text-small text-muted">No pages inside</p>;
  }
  return (
    <PageTree
      label={label}
      byParent={byParent}
      scope={scope}
      expanded={ctx.expanded}
      onExpand={ctx.onExpand}
      actions={ctx.actions}
      renderExtra={renderViews}
      moves={moves}
    />
  );
}

/** Moving needs Full access on the page (Sidebar spec, section 5). */
const canMove = (page: TreeNode) => atLeast(page.access, 'full');

/**
 * A space: a group named by its heading. Its name opens and closes its tree and takes dropped
 * entries at its top level; "+" adds a page there.
 */
function SpaceTree({ space, ctx }: { space: Space; ctx: Ctx }) {
  const key = `space:${space.id}`;
  const open = !ctx.collapsed.has(key);
  const nameId = useId();
  const tree = useQuery({
    queryKey: pagesKeys.tree(space.id),
    queryFn: () => fetchTree(space.id),
    enabled: open,
  });
  const canAddTop = space.canAddPages ?? true;
  const canAdd = canAddTop && ctx.actions.canCreate;
  const drop = useDropZone(
    (page) => canAddTop && canMove(page),
    (page) => ctx.actions.move(page, { spaceId: space.id, parentId: null }),
  );
  return (
    <div role="group" aria-labelledby={nameId} className="flex flex-col">
      <div
        className={cn(
          sidebarRowClasses(),
          'group gap-1 pr-1',
          drop.over && 'ring-2 ring-inset ring-primary',
        )}
        {...drop.zone}
      >
        <h3 className="flex min-w-0 flex-1 self-stretch">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => ctx.onCollapse([key], open)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <EntryIcon icon={space.icon} kind="space" />
            <span id={nameId} className="truncate">
              {space.name}
            </span>
          </button>
        </h3>
        <span className="flex items-center md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
          <SpaceMenu space={space} />
          {canAdd && (
            <AddButton
              label={`Add a page to ${space.name}`}
              onClick={() => {
                if (!open) ctx.onCollapse([key], false);
                ctx.actions.create({ spaceId: space.id });
              }}
            />
          )}
        </span>
      </div>
      {open && (
        <TreeBody
          query={tree}
          label={space.name}
          scope={key}
          ctx={ctx}
          moves={{ spaceId: space.id, canAddTop }}
        />
      )}
    </div>
  );
}

/**
 * The person's own pages; entries dropped on it go to its top level. Empty, it offers "Add a
 * page".
 */
function Private({ space, ctx }: { space: Space; ctx: Ctx }) {
  const tree = useQuery({ queryKey: pagesKeys.tree(space.id), queryFn: () => fetchTree(space.id) });
  const canAdd = ctx.actions.canCreate;
  const drop = useDropZone(canMove, (page) =>
    ctx.actions.move(page, { spaceId: space.id, parentId: null }),
  );
  const add = () => {
    if (ctx.collapsed.has('private')) ctx.onCollapse(['private'], false);
    ctx.actions.create({ spaceId: space.id });
  };
  return (
    <Section
      id="private"
      title="Private"
      ctx={ctx}
      drop={drop}
      add={canAdd && <AddButton label="Add a page to Private" onClick={add} />}
    >
      <TreeBody
        query={tree}
        label="Private"
        scope="private"
        ctx={ctx}
        moves={{ spaceId: space.id, canAddTop: true }}
        empty={
          canAdd ? (
            <button type="button" onClick={add} className={cn(sidebarRowClasses(), 'w-full')}>
              <Plus aria-hidden />
              Add a page
            </button>
          ) : undefined
        }
      />
    </Section>
  );
}

/** Pages shared with the person outside their spaces. Hidden when there are none. */
function Shared({ ctx }: { ctx: Ctx }) {
  const shared = useQuery({ queryKey: pagesKeys.shared, queryFn: fetchShared });
  if (shared.data?.length === 0) return null;
  return (
    <Section id="shared" title="Shared" ctx={ctx}>
      <TreeBody query={shared} label="Shared" scope="shared" ctx={ctx} />
    </Section>
  );
}

const asNode = (page: PageLink, index: number): TreeNode => ({
  id: page.id,
  parentId: null,
  kind: page.kind === 'database' ? 'database' : 'page',
  title: page.title,
  icon: page.icon,
  position: String(index),
  hasChildren: false,
  access: page.access,
});
const loaded = (results: UseQueryResult<TreeNode[]>[]) =>
  results.flatMap((result) => (result.data ? [result.data] : []));

/** Starred pages in the person's order, each opening into its sub-pages like the tree. */
function Favorites({ ctx, spaces }: { ctx: Ctx; spaces: readonly Space[] }) {
  const favorites = useQuery({ queryKey: pagesKeys.favorites, queryFn: fetchFavorites });
  const [starred] = useFlagPref('sidebar.starred', false);
  // Sub-pages come from the trees the favorites live in: a space's, or Shared.
  const mine = new Set(spaces.map((space) => space.id));
  const pages = favorites.data ?? [];
  const spaceIds = [...new Set(pages.flatMap((page) => (page.spaceId ? [page.spaceId] : [])))];
  const lists = useQueries({
    queries: [
      ...spaceIds
        .filter((id) => mine.has(id))
        .map((id) => ({ queryKey: pagesKeys.tree(id), queryFn: () => fetchTree(id) })),
      {
        queryKey: pagesKeys.shared,
        queryFn: fetchShared,
        enabled: pages.some((page) => !page.spaceId || !mine.has(page.spaceId)),
      },
    ],
    combine: loaded,
  });
  const byParent = useMemo(() => {
    const merged = new Map<string | null, TreeNode[]>();
    for (const nodes of lists) {
      for (const [parent, children] of groupChildren(nodes)) {
        if (parent !== null) merged.set(parent, children);
      }
    }
    return merged;
  }, [lists]);
  const roots = useMemo(() => favorites.data?.map(asNode), [favorites.data]);
  const drop = useDropZone(
    (page) => !ctx.actions.isFavorite(page.id),
    (page) => ctx.actions.toggleFavorite(page),
  );

  if (favorites.isError) return <Retry onRetry={() => void favorites.refetch()} />;
  if (!roots || (roots.length === 0 && starred)) return null;
  return (
    <Section id="favorites" title="Favorites" ctx={ctx} drop={drop}>
      {roots.length === 0 ? (
        <p className="px-2 py-1 text-small text-muted">Star pages to keep them here.</p>
      ) : (
        <PageTree
          label="Favorites"
          byParent={byParent}
          roots={roots}
          scope="fav"
          expanded={ctx.expanded}
          onExpand={ctx.onExpand}
          actions={ctx.actions}
          renderExtra={renderViews}
        />
      )}
    </Section>
  );
}

/** The last pages the person opened, newest first. Hidden unless the person shows it. */
function Recent({ ctx }: { ctx: Ctx }) {
  const queryClient = useQueryClient();
  const recent = useQuery({ queryKey: pagesKeys.recent, queryFn: fetchRecent });
  if (!recent.data?.length) return null;
  const clear = () => {
    queryClient.setQueryData(pagesKeys.recent, []);
    void clearRecent().catch(() => queryClient.invalidateQueries({ queryKey: pagesKeys.recent }));
  };
  return (
    <Section
      id="recent"
      title="Recent"
      ctx={ctx}
      menu={<DropdownMenuItem onSelect={clear}>Clear recent</DropdownMenuItem>}
    >
      <ul className="flex flex-col">
        {recent.data.map((page) => (
          <li key={page.id}>
            <NavLink
              to={pageUrl(page.id)}
              className={({ isActive }) => cn(sidebarRowClasses({ active: isActive }), 'pl-7')}
            >
              <EntryIcon icon={page.icon} kind={page.kind} />
              <span className="truncate">{titleOf(page)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </Section>
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
    <div className="flex flex-col gap-2 px-2 py-1">
      <VisuallyHidden role="status">Loading pages</VisuallyHidden>
      {['w-3/4', 'w-1/2', 'w-2/3'].map((width) => (
        <Skeleton key={width} className={cn('h-4', width)} />
      ))}
    </div>
  );
}

function Retry({ onRetry }: { onRetry(): void }) {
  return (
    <p className="flex items-center gap-2 px-2 py-1 text-small text-muted">
      Couldn&apos;t load these pages.
      <button type="button" onClick={onRetry} className="font-medium text-fg underline">
        Retry
      </button>
    </p>
  );
}
