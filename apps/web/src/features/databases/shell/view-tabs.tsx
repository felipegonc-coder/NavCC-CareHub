/**
 * The view tabs (spec section 3.2): "+" adds a view, tabs that don't fit go into "More", and the
 * view showing has "…" with Rename, Duplicate, Move left, Move right and Delete (with Undo; the
 * last view stays). Tabs can also be dragged into order. On phones the tabs become a dropdown
 * (section 6), and so do a block's when its view says so (tabsAs).
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type RefObject,
} from 'react';
import { ChevronDown, Ellipsis, Plus } from 'lucide-react';
import { LIMITS, VIEW_LAYOUTS, type Id, type View } from '@carehub/databases';
import { LAYOUT_LABELS } from '@carehub/databases/schema';
import {
  Button,
  buttonClasses,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  TabsList,
  TabsTrigger,
} from '@carehub/ui';
import type { DatabaseClient, DatabaseWithVersion, ViewAnswer } from '../api';
import { useOrderViews, useSettingsChange, useUpdateView } from '../hooks';
import { errorText } from './states';
import {
  fitTabs,
  newViewName,
  placeTab,
  TAB_TEXT,
  tabAfterDelete,
  VIEW_NAME_MAX,
  viewMenuLabel,
} from './tabs';
import { useToasts } from './toasts';

export interface ViewTabsProps {
  meta: DatabaseWithVersion;
  /** The tabs in order, without views waiting to be deleted. */
  tabs: readonly View[];
  /** The view showing. */
  view: View;
  /** Online with edit_views: "+", the view's "…" and dragging. */
  canEdit: boolean;
  /** The tabs as a dropdown at every size. */
  dropdown: boolean;
  /** An open search box takes the tabs' place on a phone. */
  searching: boolean;
  onPick(viewId: Id): void;
  /** Delete in "…" (useDeleteView). */
  onDelete(viewId: Id): void;
}

interface Drag {
  viewId: Id;
  /** The tab it would land next to. */
  over: Id | null;
}

const tabName = (view: View) => view.name || 'Untitled';

/**
 * What a dragged tab carries: its view's id, and no text, so the page around a database block
 * doesn't take a drop on the tabs as text to paste.
 */
export const TAB_DRAG_TYPE = 'application/x-carehub-view';

/** Settings writes from the tabs; a refused one says why in a toast. */
function useTabWrites(databaseId: Id, onPick: (viewId: Id) => void) {
  const toasts = useToasts();
  const settings = useSettingsChange(databaseId);
  const order = useOrderViews(databaseId);
  const updateView = useUpdateView(databaseId);
  const refused = (error: unknown) => toasts.show({ message: errorText(error) });
  return {
    /** A new view or a copy, which shows once it's saved. */
    add: (write: (client: DatabaseClient) => Promise<ViewAnswer>) =>
      void settings.mutateAsync(write).then((answer) => {
        if ('viewId' in answer && typeof answer.viewId === 'string') onPick(answer.viewId);
      }, refused),
    move: (viewIds: Id[] | null) => {
      if (viewIds) void order.mutateAsync(viewIds).catch(refused);
    },
    rename: (viewId: Id, name: string) =>
      void updateView.mutateAsync({ viewId, change: { name } }).catch(refused),
  };
}

type TabWrites = ReturnType<typeof useTabWrites>;

export function ViewTabs(props: ViewTabsProps) {
  const { meta, tabs, view, canEdit, dropdown, onPick } = props;
  const writes = useTabWrites(meta.id, onPick);
  const row = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const ruler = useRef<HTMLDivElement | null>(null);
  const tail = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const at = tabs.findIndex((v) => v.id === view.id);
  const names = tabs.map(tabName);
  const fit = useFit({ row, list, ruler, tail, names, active: at, off: dropdown });
  const shown = fit ? tabs.filter((_, i) => fit.includes(i)) : tabs;
  const more = fit ? tabs.filter((_, i) => !fit.includes(i)) : [];

  // Dropped on a tab's left half, a tab lands before it; on its right half, after it.
  const later = (e: DragEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX > box.left + box.width / 2;
  };
  const dragProps = (tab: View) =>
    canEdit && !dropdown
      ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLButtonElement>) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
            setDrag({ viewId: tab.id, over: null });
          },
          onDragOver: (e: DragEvent<HTMLButtonElement>) => {
            if (!drag || drag.viewId === tab.id) return;
            e.preventDefault();
            if (drag.over !== tab.id) setDrag({ ...drag, over: tab.id });
          },
          onDrop: (e: DragEvent<HTMLButtonElement>) => {
            e.preventDefault();
            if (drag && drag.viewId !== tab.id) {
              writes.move(placeTab(meta.views, drag.viewId, tab.id, later(e)));
            }
            setDrag(null);
          },
          onDragEnd: () => setDrag(null),
        }
      : {};

  return (
    <div
      ref={row}
      className={cn(
        'relative flex min-w-0 flex-1 items-end gap-1 border-b border-border',
        props.searching && 'max-md:hidden',
      )}
    >
      <TabsList
        ref={list}
        aria-label={TAB_TEXT.views}
        className={cn('min-w-0 border-b-0', dropdown ? 'hidden' : 'max-md:hidden')}
      >
        {shown.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className={cn('max-w-full truncate', drag?.over === tab.id && 'bg-fill')}
            {...dragProps(tab)}
          >
            {tabName(tab)}
          </TabsTrigger>
        ))}
      </TabsList>
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="mb-1 max-md:hidden">
              {TAB_TEXT.more}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => onPick(tab.id)}>
                {tabName(tab)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ViewPicker tabs={tabs} view={view} onPick={onPick} always={dropdown} />
      {canEdit && (
        <div ref={tail} className="mb-1 flex shrink-0 items-center">
          <ViewMenu {...props} writes={writes} />
          {meta.views.length < LIMITS.views && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={TAB_TEXT.addView} size="sm">
                  <Plus aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {VIEW_LAYOUTS.map((layout) => (
                  <DropdownMenuItem
                    key={layout}
                    onSelect={() =>
                      writes.add((client) =>
                        client.createView(meta.id, {
                          layout,
                          name: newViewName(layout, meta.views),
                        }),
                      )
                    }
                  >
                    {LAYOUT_LABELS[layout]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {!dropdown && (
        // A hidden copy of the tabs and More, measured to see which tabs fit.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden"
        >
          <div ref={ruler} className="invisible flex w-max">
            {tabs.map((tab) => (
              <span key={tab.id} className="whitespace-nowrap px-1 text-small font-medium">
                {tabName(tab)}
              </span>
            ))}
            <span className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              {TAB_TEXT.more}
              <ChevronDown />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The view's "…": Rename (a box under it: Enter or a click elsewhere saves, Esc keeps the old
 * name), Duplicate, Move left, Move right and Delete.
 */
function ViewMenu({ meta, tabs, view, onDelete, writes }: ViewTabsProps & { writes: TabWrites }) {
  const button = useRef<HTMLButtonElement | null>(null);
  // Rename opens a box in place of the menu, so the menu leaves focus to it.
  const keepFocus = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const at = tabs.findIndex((v) => v.id === view.id);
  const before = tabs[at - 1];
  const after = tabs[at + 1];

  const finish = (save: boolean) => {
    const name = draft?.trim() ?? '';
    setDraft(null);
    if (save && name !== '' && name !== view.name) writes.rename(view.id, name);
  };

  return (
    <Popover
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) finish(true);
      }}
    >
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <IconButton ref={button} label={viewMenuLabel(view)} size="sm">
              <Ellipsis aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(e) => {
            if (!keepFocus.current) return;
            keepFocus.current = false;
            e.preventDefault();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              keepFocus.current = true;
              setDraft(view.name);
            }}
          >
            {TAB_TEXT.rename}
          </DropdownMenuItem>
          {meta.views.length < LIMITS.views && (
            <DropdownMenuItem
              onSelect={() => writes.add((client) => client.duplicateView(meta.id, view.id))}
            >
              {TAB_TEXT.duplicate}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!before}
            onSelect={() =>
              writes.move(before ? placeTab(meta.views, view.id, before.id, false) : null)
            }
          >
            {TAB_TEXT.moveLeft}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!after}
            onSelect={() =>
              writes.move(after ? placeTab(meta.views, view.id, after.id, true) : null)
            }
          >
            {TAB_TEXT.moveRight}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            disabled={tabs.length < 2}
            onSelect={() => onDelete(view.id)}
          >
            {TAB_TEXT.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {draft !== null && (
        <PopoverContent
          align="start"
          aria-label={TAB_TEXT.rename}
          className="w-64 p-2"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            finish(false);
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            button.current?.focus();
          }}
        >
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              finish(true);
            }}
          >
            <Input
              aria-label={TAB_TEXT.viewName}
              value={draft}
              maxLength={VIEW_NAME_MAX}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </form>
        </PopoverContent>
      )}
    </Popover>
  );
}

interface ViewPickerProps {
  tabs: readonly View[];
  view: View;
  onPick(viewId: Id): void;
  /** At every size; otherwise on phones only. */
  always: boolean;
}

/** The tabs as a dropdown. */
function ViewPicker({ tabs, view, onPick, always }: ViewPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${TAB_TEXT.views}: ${tabName(view)}`}
          className={cn('mb-1 min-w-0', !always && 'md:hidden')}
        >
          <span className="truncate">{tabName(view)}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={TAB_TEXT.views}>
        <DropdownMenuRadioGroup value={view.id} onValueChange={onPick}>
          {tabs.map((tab) => (
            <DropdownMenuRadioItem key={tab.id} value={tab.id}>
              {tabName(tab)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FitInput {
  row: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLDivElement | null>;
  ruler: RefObject<HTMLDivElement | null>;
  tail: RefObject<HTMLDivElement | null>;
  names: readonly string[];
  active: number;
  off: boolean;
}

const gapOf = (element: Element) => parseFloat(getComputedStyle(element).columnGap) || 0;

/**
 * The tabs that fit beside More (their places), measured on the hidden copy whenever the strip
 * or the names change size. Null: all of them, also where there's no ResizeObserver (tests).
 */
function useFit({ row, list, ruler, tail, names, active, off }: FitInput): number[] | null {
  const [fit, setFit] = useState<number[] | null>(null);
  const key = names.join('\n');
  useLayoutEffect(() => {
    const strip = row.current;
    const copy = ruler.current;
    const tabs = list.current;
    if (off || !strip || !copy || !tabs || typeof ResizeObserver === 'undefined') {
      setFit(null);
      return;
    }
    const measure = () => {
      const widths = Array.from(copy.children, (el) =>
        el instanceof HTMLElement ? el.offsetWidth : 0,
      );
      const more = widths.pop() ?? 0;
      const gap = gapOf(strip);
      const room = strip.clientWidth - (tail.current ? tail.current.offsetWidth + gap : 0);
      const next = fitTabs({ widths, gap: gapOf(tabs), room, more: more + gap, active });
      const all = next.length === widths.length;
      setFit((last) => (all ? null : last && same(last, next) ? last : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [row, list, ruler, tail, key, active, off]);
  return fit;
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Delete with Undo (spec section 3.2). No route brings a view back, so its tab only hides at
 * first, and the DELETE goes when the toast does without Undo. The last view can't be deleted.
 */
export function useDeleteView(databaseId: Id, pick: (viewId: Id) => void) {
  const toasts = useToasts();
  const settings = useSettingsChange(databaseId);
  const [hidden, setHidden] = useState<ReadonlySet<Id>>(() => new Set());
  const hide = (viewId: Id, on: boolean) =>
    setHidden((last) => {
      const next = new Set(last);
      if (on) next.add(viewId);
      else next.delete(viewId);
      return next;
    });

  const remove = (viewId: Id, tabs: readonly View[], shownId: Id) => {
    const next = tabAfterDelete(tabs, viewId);
    if (!next) return;
    hide(viewId, true);
    if (viewId === shownId) pick(next);
    toasts.show({
      message: TAB_TEXT.deleted,
      onUndo: () => {
        hide(viewId, false);
        if (viewId === shownId) pick(viewId);
      },
      onDone: () =>
        void settings
          .mutateAsync((client) => client.deleteView(databaseId, viewId))
          .catch((error: unknown) => {
            hide(viewId, false);
            toasts.show({ message: errorText(error) });
          }),
    });
  };
  return { hidden, remove };
}
