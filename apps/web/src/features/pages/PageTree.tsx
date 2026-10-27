import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  sidebarRowClasses,
} from '@carehub/ui';
import {
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
  Users,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { atLeast, pageUrl } from './access';
import type { EntryActions } from './actions';
import { draggedPage, endDrag, startDrag } from './drag';
import { dropPlace, dropTarget, stepTarget, type DropPlace, type MoveScope } from './move';
import type { PageIcon, TreeNode } from './types';
import {
  FIRST_STEP,
  isFocusable,
  keyAction,
  MORE_STEP,
  nestRows,
  pathTo,
  rootedRows,
  rowKey,
  visibleRows,
  type TreeRow,
} from './tree';

type Row = TreeRow<TreeNode>;
type NodeRow = Extract<Row, { kind: 'node' }>;

const LONG_PRESS_MS = 500;
const indent = (level: number) => ({ paddingLeft: 4 + (level - 1) * 12 });
/** Ignores events that bubbled through React from a menu rendered elsewhere in the page. */
const fromInside = (event: SyntheticEvent) => event.currentTarget.contains(event.target as Node);
/** Whether the event is the entry's own, not one from a sub-page inside it or from a menu. */
const own = (event: SyntheticEvent) =>
  event.target instanceof Element &&
  event.target.closest('[role="treeitem"]') === event.currentTarget;
/** An entry holds its sub-pages, so the keyboard focus is drawn on the entry's own row. */
const ROW_FOCUS =
  'outline-none [&:focus-visible>div]:outline [&:focus-visible>div]:outline-2 [&:focus-visible>div]:outline-offset-[-2px] [&:focus-visible>div]:outline-[rgb(var(--ch-ring))]';

export function EntryIcon({ icon, kind }: { icon: PageIcon | null; kind: string }) {
  if (icon?.type === 'emoji') {
    return (
      <span aria-hidden className="w-4 shrink-0 text-center leading-none">
        {icon.emoji}
      </span>
    );
  }
  const Icon = kind === 'database' ? Database : kind === 'space' ? Users : FileText;
  return <Icon aria-hidden className="text-muted" />;
}

export const titleOf = (page: { title: string }) => page.title.trim() || 'Untitled';

export interface PageTreeProps {
  /** Names the tree for screen readers, such as the space's name. */
  label: string;
  /** Entries by parent ID (see `groupChildren`). */
  byParent: ReadonlyMap<string | null, readonly TreeNode[]>;
  /** Favorites: these entries at the top, in this order, instead of the top of `byParent`. */
  roots?: readonly TreeNode[] | undefined;
  /** Keeps what's open here apart from other trees showing the same pages. */
  scope: string;
  expanded: ReadonlySet<string>;
  onExpand(keys: readonly string[], open: boolean): void;
  actions: EntryActions;
  /** What an open database shows under it: its views, from the Databases lane. */
  renderExtra?: ((page: TreeNode) => ReactNode) | undefined;
  /** For a space's tree: entries can be dropped here and moved with Ctrl+Shift+↑ and ↓. */
  moves?: MoveScope | undefined;
}

/** Handlers that make a row a drag source and a drop target. */
interface RowDrag {
  place: DropPlace | null;
  start(event: DragEvent<HTMLElement>): void;
  over(event: DragEvent<HTMLElement>): void;
  leave(event: DragEvent<HTMLElement>): void;
  drop(event: DragEvent<HTMLElement>): void;
  end(): void;
}

/** A page tree with the tree keyboard pattern (Sidebar spec, sections 2 and 6). */
export function PageTree(props: PageTreeProps) {
  const { label, byParent, roots, scope, expanded, onExpand, actions, renderExtra, moves } = props;
  const navigate = useNavigate();
  const current = useMatch('/p/:pageId')?.params.pageId;
  const treeRef = useRef<HTMLUListElement>(null);
  const revealed = useRef<string | null>(null);
  const renaming = useRef(false);
  const [shown, setShown] = useState<ReadonlyMap<string | null, number>>(new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; place: DropPlace } | null>(null);

  const rows = useMemo(() => {
    const hasExtra = renderExtra ? (page: TreeNode) => page.kind === 'database' : undefined;
    const options = { expanded, shown, scope, hasExtra };
    return roots ? rootedRows(roots, byParent, options) : visibleRows(byParent, options);
  }, [byParent, roots, expanded, shown, scope, renderExtra]);

  // The open page is highlighted and the entries above it open, once per page opened (in its
  // space; Favorites stay as the person left them).
  useEffect(() => {
    if (roots || !current || revealed.current === current) return;
    const path = pathTo(byParent, current);
    if (!path) return;
    revealed.current = current;
    const closed = path.map((id) => rowKey(scope, id)).filter((key) => !expanded.has(key));
    if (closed.length > 0) onExpand(closed, true);
    setTimeout(() => {
      treeRef.current
        ?.querySelector(`[data-key="${rowKey(scope, current)}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [roots, current, byParent, scope, expanded, onExpand]);

  const focusable = rows.filter(isFocusable);
  const tabbable = (
    focusable.find((row) => row.key === focusKey) ??
    focusable.find((row) => row.kind === 'node' && row.node.id === current) ??
    focusable[0]
  )?.key;

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    treeRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  };
  const showMore = (parentId: string | null) =>
    setShown((before) =>
      new Map(before).set(parentId, (before.get(parentId) ?? FIRST_STEP) + MORE_STEP),
    );

  /** Where a drop on this row would put the dragged entry, if it may go there. */
  const dropAt = (row: NodeRow, event: DragEvent<HTMLElement>) => {
    const page = draggedPage();
    if (!page || !moves) return null;
    const rect = (
      event.currentTarget.firstElementChild ?? event.currentTarget
    ).getBoundingClientRect();
    const place = dropPlace(rect, event.clientY, row.node.kind === 'page');
    const to = dropTarget(byParent, page, row.node, place, moves);
    return to && { page, place, to };
  };
  const rowDrag = (row: NodeRow): RowDrag => ({
    place: drop?.key === row.key ? drop.place : null,
    start: (event) => startDrag(event, row.node),
    over(event) {
      const at = dropAt(row, event);
      if (!at) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (drop?.key !== row.key || drop.place !== at.place)
        setDrop({ key: row.key, place: at.place });
    },
    leave(event) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
    },
    drop(event) {
      const at = dropAt(row, event);
      setDrop(null);
      if (!at) return;
      event.preventDefault();
      endDrag();
      if (at.place === 'inside') onExpand([row.key], true);
      actions.move(at.page, at.to);
    },
    end() {
      endDrag();
      setDrop(null);
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!fromInside(event) || target.tagName === 'INPUT' || event.altKey) return;
    const index = rows.findIndex((row) => row.key === tabbable);
    const ctrl = event.ctrlKey || event.metaKey;
    const action = keyAction(rows, index, event.key, { shift: event.shiftKey, ctrl });
    if (!action) return;
    event.preventDefault();
    const row = 'index' in action ? rows[action.index] : undefined;
    switch (action.type) {
      case 'focus':
        focusRow(row?.key);
        break;
      case 'expand':
      case 'collapse':
        onExpand([action.key], action.type === 'expand');
        break;
      case 'open':
        if (row?.kind === 'node') void navigate(pageUrl(row.node.id));
        else if (row?.kind === 'more') showMore(row.parentId);
        break;
      case 'menu':
        setMenuKey(row?.key ?? null);
        break;
      case 'rename':
        if (row?.kind === 'node' && atLeast(row.node.access, 'edit')) setRenameKey(row.key);
        break;
      case 'reorder': {
        if (row?.kind !== 'node' || !moves || !atLeast(row.node.access, 'full')) break;
        const to = stepTarget(byParent, row.node, action.step, moves);
        if (!to) break;
        actions.move(row.node, to);
        setTimeout(() => focusRow(row.key)); // the row moved; keep the keyboard on it
        break;
      }
    }
  };

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-col"
    >
      {nestRows(rows, (row, inside: ReactNode[]) => {
        const common = { 'data-key': row.key, style: indent(row.level) };
        if (row.kind === 'more') {
          return (
            <li
              key={row.key}
              role="treeitem"
              aria-level={row.level}
              aria-posinset={row.posInSet}
              aria-setsize={row.posInSet}
              aria-selected={false}
              tabIndex={row.key === tabbable ? 0 : -1}
              onFocus={(event) => event.target === event.currentTarget && setFocusKey(row.key)}
              className={sidebarRowClasses()}
              {...common}
            >
              <button
                type="button"
                tabIndex={-1}
                className="flex-1 self-stretch pl-6 text-left"
                onClick={() => showMore(row.parentId)}
              >
                Show {MORE_STEP} more
              </button>
            </li>
          );
        }
        if (row.kind === 'empty') {
          return (
            <li
              key={row.key}
              role="treeitem"
              aria-level={row.level}
              aria-selected={false}
              aria-disabled
              className="flex h-8 items-center pl-6 text-small text-muted max-md:h-11"
              {...common}
            >
              No pages inside
            </li>
          );
        }
        if (row.kind === 'extra') {
          return (
            <li key={row.key} role="group" {...common}>
              {renderExtra?.(row.node)}
            </li>
          );
        }
        return (
          <TreeItem
            key={row.key}
            row={row}
            topLevel={!roots && row.level === 1}
            tabbable={row.key === tabbable}
            current={row.node.id === current}
            menuOpen={menuKey === row.key}
            renaming={renameKey === row.key}
            actions={actions}
            drag={rowDrag(row)}
            onFocusRow={() => setFocusKey(row.key)}
            onToggle={() => {
              onExpand([row.key], !row.expanded);
              focusRow(row.key);
            }}
            onMenu={(open) => setMenuKey(open ? row.key : null)}
            onMenuClosed={() => {
              if (renaming.current) renaming.current = false;
              else focusRow(row.key);
            }}
            onRename={() => {
              renaming.current = true; // the menu closing mustn't take focus from the title box
              setRenameKey(row.key);
            }}
            onRenamed={(title, keyboard) => {
              setRenameKey(null);
              if (title !== null && title !== row.node.title.trim())
                actions.rename(row.node.id, title);
              if (keyboard) focusRow(row.key);
            }}
            onAddInside={() => {
              onExpand([row.key], true);
              actions.create({ parentId: row.node.id });
            }}
          >
            {inside.length > 0 && (
              <ul role="group" className="flex flex-col">
                {inside}
              </ul>
            )}
          </TreeItem>
        );
      })}
    </ul>
  );
}

interface TreeItemProps {
  row: NodeRow;
  /** At the top of a space or of Shared, so a parent the person can't open is mentioned. */
  topLevel: boolean;
  tabbable: boolean;
  current: boolean;
  menuOpen: boolean;
  renaming: boolean;
  actions: EntryActions;
  drag: RowDrag;
  onFocusRow(): void;
  onToggle(): void;
  onMenu(open: boolean): void;
  onMenuClosed(): void;
  onRename(): void;
  onRenamed(title: string | null, keyboard: boolean): void;
  onAddInside(): void;
  /** Its sub-pages, when open. */
  children?: ReactNode;
}

function TreeItem({
  row,
  topLevel,
  tabbable,
  current,
  menuOpen,
  renaming,
  actions,
  drag,
  children,
  ...on
}: TreeItemProps) {
  const { node } = row;
  const titleId = useId();
  const pathId = useId();
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const pointer = useRef('');
  const onSubPage = useRef(false);
  const title = titleOf(node);
  const canEdit = atLeast(node.access, 'edit');
  const canDrag = atLeast(node.access, 'full') && !renaming;
  const canAddInside = canEdit && actions.canCreate && node.kind === 'page';
  const hiddenParent = topLevel && (node.pathHidden ?? node.parentId !== null);
  const endPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  return (
    <li
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={current}
      aria-current={current ? 'page' : undefined}
      aria-labelledby={titleId}
      aria-describedby={hiddenParent ? pathId : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-key={row.key}
      onFocus={(event) => event.target === event.currentTarget && on.onFocusRow()}
      onContextMenu={(event) => {
        if (!own(event)) return;
        event.preventDefault();
        on.onMenu(true);
      }}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!own(event)) return; // a sub-page inside is being dragged
        // On touch screens a long press opens the menu instead; "Move to" moves the entry. A drag
        // begun on a sub-page that can't move mustn't move this entry instead.
        if (!canDrag || pointer.current === 'touch' || onSubPage.current) event.preventDefault();
        else drag.start(event);
      }}
      onDragOver={(event) => own(event) && drag.over(event)}
      onDragLeave={(event) => own(event) && drag.leave(event)}
      onDrop={(event) => own(event) && drag.drop(event)}
      onDragEnd={(event) => own(event) && drag.end()}
      onPointerDown={(event) => {
        pointer.current = event.pointerType;
        onSubPage.current = !own(event);
        if (event.pointerType !== 'touch' || onSubPage.current) return;
        pressed.current = false;
        press.current = setTimeout(() => {
          pressed.current = true;
          on.onMenu(true);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onPointerLeave={endPress}
      className={ROW_FOCUS}
    >
      <div
        className={cn(
          sidebarRowClasses({ active: current }),
          'group relative gap-1 pr-1',
          hiddenParent && 'h-auto min-h-8 py-1',
          drag.place === 'inside' && 'ring-2 ring-inset ring-primary',
        )}
        style={indent(row.level)}
      >
        {(drag.place === 'before' || drag.place === 'after') && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-1 h-0.5 rounded bg-primary',
              drag.place === 'before' ? '-top-px' : '-bottom-px',
            )}
          />
        )}
        {row.expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={on.onToggle}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-fill-hover hover:text-fg"
          >
            <ChevronRight className={cn('transition-transform', row.expanded && 'rotate-90')} />
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <EntryIcon icon={node.icon} kind={node.kind} />
        {renaming ? (
          <TitleInput initial={node.title} onDone={on.onRenamed} />
        ) : (
          <Link
            to={pageUrl(node.id)}
            tabIndex={-1}
            draggable={false}
            onClick={(event) => {
              if (!pressed.current) return;
              pressed.current = false; // the long-press opened the menu instead
              event.preventDefault();
            }}
            className="flex min-w-0 flex-1 flex-col justify-center self-stretch [-webkit-touch-callout:none]"
          >
            <span id={titleId} className="truncate">
              {title}
            </span>
            {hiddenParent && (
              <span id={pathId} className="truncate text-label text-muted">
                In a page you can&apos;t open
              </span>
            )}
          </Link>
        )}
        <span
          className={cn(
            'flex shrink-0 items-center max-md:pointer-events-none max-md:w-0 max-md:overflow-hidden',
            !menuOpen &&
              'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:[li:focus>div>&]:opacity-100',
          )}
        >
          <DropdownMenu open={menuOpen} onOpenChange={on.onMenu}>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More for ${title}`} size="sm" tabIndex={-1} className="size-6">
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <EntryMenu
              page={node}
              actions={actions}
              canAddInside={canAddInside}
              onAddInside={on.onAddInside}
              onRename={on.onRename}
              onClosed={on.onMenuClosed}
            />
          </DropdownMenu>
          {canAddInside && (
            <IconButton
              label={`Add a page inside ${title}`}
              size="sm"
              tabIndex={-1}
              className="size-6"
              onClick={on.onAddInside}
            >
              <Plus aria-hidden />
            </IconButton>
          )}
        </span>
      </div>
      {children}
    </li>
  );
}

interface EntryMenuProps {
  page: TreeNode;
  actions: EntryActions;
  canAddInside: boolean;
  onAddInside(): void;
  onRename(): void;
  onClosed(): void;
}

/** The entry's "…" menu, with only what the person may do (Sidebar spec, section 3.2). */
function EntryMenu({
  page,
  actions,
  canAddInside,
  onAddInside,
  onRename,
  onClosed,
}: EntryMenuProps) {
  const favorite = actions.isFavorite(page.id);
  return (
    <DropdownMenuContent
      align="start"
      className="w-60"
      onCloseAutoFocus={(event: Event) => {
        event.preventDefault();
        onClosed();
      }}
    >
      {canAddInside && (
        <DropdownMenuItem onSelect={onAddInside}>
          <Plus aria-hidden />
          Add a page inside
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => actions.toggleFavorite(page)}>
        {favorite ? <StarOff aria-hidden /> : <Star aria-hidden />}
        {favorite ? 'Remove from Favorites' : 'Add to Favorites'}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.copyLink(page.id)}>
        <Link2 aria-hidden />
        Copy link
      </DropdownMenuItem>
      {atLeast(page.access, 'edit') && (
        <DropdownMenuItem onSelect={onRename}>
          <Pencil aria-hidden />
          Rename
          <Kbd className="ml-auto">F2</Kbd>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => window.open(pageUrl(page.id), '_blank', 'noopener')}>
        <ExternalLink aria-hidden />
        Open in new tab
      </DropdownMenuItem>
      {atLeast(page.access, 'full') && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="danger" onSelect={() => actions.trash(page)}>
            <Trash2 aria-hidden />
            Move to Trash
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

/** Inline rename: Enter saves, Escape cancels, clicking away saves. */
function TitleInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone(title: string | null, keyboard: boolean): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (title: string | null, keyboard: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(title === null ? null : title.trim(), keyboard);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Page title"
      maxLength={2000}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(event.currentTarget.value, true);
        else if (event.key === 'Escape') finish(null, true);
      }}
      onBlur={(event) => finish(event.currentTarget.value, false)}
      className="h-6 min-w-0 flex-1 rounded border border-border bg-bg px-1 text-small text-fg"
    />
  );
}
