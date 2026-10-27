import { cn, sidebarRowClasses } from '@carehub/ui';
import { ChevronRight, Database, FileText, Users } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { pageUrl } from './access';
import type { PageIcon, TreeNode } from './types';
import {
  FIRST_STEP,
  isFocusable,
  keyAction,
  MORE_STEP,
  nestRows,
  pathTo,
  rowKey,
  visibleRows,
  type TreeRow,
} from './tree';

type NodeRow = Extract<TreeRow<TreeNode>, { kind: 'node' }>;

const indent = (level: number) => ({ paddingLeft: 4 + (level - 1) * 12 });
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
  /** Keeps what's open here apart from other trees showing the same pages. */
  scope: string;
  expanded: ReadonlySet<string>;
  onExpand(keys: readonly string[], open: boolean): void;
  /** What an open database shows under it: its views, from the Databases lane. */
  renderExtra?: ((page: TreeNode) => ReactNode) | undefined;
}

/** A page tree with the tree keyboard pattern (Sidebar spec, sections 2 and 6). */
export function PageTree({
  label,
  byParent,
  scope,
  expanded,
  onExpand,
  renderExtra,
}: PageTreeProps) {
  const navigate = useNavigate();
  const current = useMatch('/p/:pageId')?.params.pageId;
  const treeRef = useRef<HTMLUListElement>(null);
  const revealed = useRef<string | null>(null);
  const [shown, setShown] = useState<ReadonlyMap<string | null, number>>(new Map());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const hasExtra = renderExtra ? (page: TreeNode) => page.kind === 'database' : undefined;
    return visibleRows(byParent, { expanded, shown, scope, hasExtra });
  }, [byParent, expanded, shown, scope, renderExtra]);

  // The open page is highlighted and the entries above it open, once per page opened.
  useEffect(() => {
    if (!current || revealed.current === current) return;
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
  }, [current, byParent, scope, expanded, onExpand]);

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

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || target.tagName === 'INPUT') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = rows.findIndex((row) => row.key === tabbable);
    const action = keyAction(rows, index, event.key, { shift: event.shiftKey });
    if (!action || action.type === 'menu' || action.type === 'rename') return;
    event.preventDefault();
    if (action.type === 'expand' || action.type === 'collapse') {
      onExpand([action.key], action.type === 'expand');
      return;
    }
    const row = rows[action.index];
    if (action.type === 'focus') focusRow(row?.key);
    else if (row?.kind === 'node') void navigate(pageUrl(row.node.id));
    else if (row?.kind === 'more') showMore(row.parentId);
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
        if (row.kind === 'node') {
          return (
            <TreeItem
              key={row.key}
              row={row}
              topLevel={row.level === 1}
              tabbable={row.key === tabbable}
              current={row.node.id === current}
              onFocusRow={() => setFocusKey(row.key)}
              onToggle={() => {
                onExpand([row.key], !row.expanded);
                focusRow(row.key);
              }}
            >
              {inside.length > 0 && (
                <ul role="group" className="flex flex-col">
                  {inside}
                </ul>
              )}
            </TreeItem>
          );
        }
        if (row.kind === 'extra') {
          return (
            <li key={row.key} role="group" data-key={row.key} style={indent(row.level)}>
              {renderExtra?.(row.node)}
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
              data-key={row.key}
              style={indent(row.level)}
              className="flex h-8 items-center pl-6 text-small text-muted max-md:h-11"
            >
              No pages inside
            </li>
          );
        }
        return (
          <li
            key={row.key}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.posInSet}
            aria-setsize={row.posInSet}
            aria-selected={false}
            tabIndex={row.key === tabbable ? 0 : -1}
            data-key={row.key}
            style={indent(row.level)}
            onFocus={() => setFocusKey(row.key)}
            className={sidebarRowClasses()}
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
      })}
    </ul>
  );
}

interface TreeItemProps {
  row: NodeRow;
  /** At the top of a space or of Shared, where a parent the person can't open is mentioned. */
  topLevel: boolean;
  tabbable: boolean;
  current: boolean;
  onFocusRow(): void;
  onToggle(): void;
  /** Its sub-pages, when open. */
  children?: ReactNode;
}

function TreeItem(props: TreeItemProps) {
  const { row, topLevel, tabbable, current, onFocusRow, onToggle, children } = props;
  const { node } = row;
  const titleId = useId();
  const pathId = useId();
  const hiddenParent = topLevel && (node.pathHidden ?? node.parentId !== null);
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
      onFocus={(event) => event.target === event.currentTarget && onFocusRow()}
      className={ROW_FOCUS}
    >
      <div
        className={cn(
          sidebarRowClasses({ active: current }),
          'group gap-1 pr-1',
          hiddenParent && 'h-auto min-h-8 py-1',
        )}
        style={indent(row.level)}
      >
        {row.expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={onToggle}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-fill-hover hover:text-fg"
          >
            <ChevronRight className={cn('transition-transform', row.expanded && 'rotate-90')} />
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <EntryIcon icon={node.icon} kind={node.kind} />
        <Link
          to={pageUrl(node.id)}
          tabIndex={-1}
          draggable={false}
          className="flex min-w-0 flex-1 flex-col justify-center self-stretch"
        >
          <span id={titleId} className="truncate">
            {titleOf(node)}
          </span>
          {hiddenParent && (
            <span id={pathId} className="truncate text-label text-muted">
              In a page you can&apos;t open
            </span>
          )}
        </Link>
      </div>
      {children}
    </li>
  );
}
