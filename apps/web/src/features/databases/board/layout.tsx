import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { Id, OptionColor } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { pageUrl } from '@carehub/shared';
import { Button, cn, colorClasses, IconButton, Input, useToast } from '@carehub/ui';
import { CELL_TEXT } from '../cells';
import {
  cellContext,
  type LayoutProps,
  type QueryGroup,
  type QueryLane,
  type QueryRow,
  type ViewData,
} from '../contract';
import { boardOptions } from '../filters/layout-model';
import { BoardCard, type MoveChoice } from './card';
import { collapsedKey, laneCollapsedKey, useCollapsed } from './collapsed';
import { useCardDrag, type DropTarget } from './drag';
import { BOARD_TEXT } from './messages';
import {
  asQueryRow,
  beforeRowAt,
  boardColumns,
  boardLanes,
  canMoveTo,
  cardPicture,
  cardProperties,
  inAnswer,
  isArrow,
  laneValues,
  pickedMoved,
  rowPlace,
  sameSlot,
  slotKey,
  slotRows,
  stepPicked,
  withGroupShown,
  type Arrow,
  type Picked,
  type Slot,
} from './model';

const COLUMN_WIDTH = { s: 'w-56', m: 'w-64', l: 'w-80' } as const;

/** A card made here, shown until the answer has it ("Hidden by filter" if a newer one doesn't). */
interface Created {
  row: QueryRow;
  slot: Slot;
  data: ViewData;
}

const titleOf = (row: QueryRow) => row.title || CELL_TEXT.untitled;
const cardKey = (rowId: Id, slot: Slot) => `${slotKey(slot)}\n${rowId}`;
const chipClasses = (color: OptionColor | undefined) =>
  cn(
    'min-w-0 truncate rounded-sm px-1.5 text-small font-medium',
    color ? cn(colorClasses[color].bg, colorClasses[color].text) : 'text-fg',
  );

/** A card to focus once it's drawn in a slot, asked for while the view showed `data`. */
interface FocusRequest {
  rowId: Id;
  slot: string;
  data: ViewData;
}

/** The focusable part of a card: in the slot, or with `anywhere`, wherever it is. */
function findCard(
  root: HTMLElement | null,
  { rowId, slot }: FocusRequest,
  anywhere: boolean,
): HTMLElement | null {
  if (!root) return null;
  const all = [...root.querySelectorAll<HTMLElement>('[data-card-open]')].filter(
    (el) => el.closest<HTMLElement>('article[data-row-id]')?.dataset.rowId === rowId,
  );
  const here = all.find(
    (el) => el.closest<HTMLElement>('[data-board-slot]')?.dataset.boardSlot === slot,
  );
  return here ?? (anywhere ? (all[0] ?? null) : null);
}

/**
 * The board (spec: Board): a column per group of the view's grouping, split into lanes by its
 * sub-grouping. Cards move by drag, by keyboard (Space, arrows, Space) and with "Move to…".
 */
export default function BoardLayout({ meta, view, data, viewer, actions, readOnly }: LayoutProps) {
  const { toast } = useToast();
  const options = boardOptions(view, meta.properties);
  const ctx = useMemo(() => cellContext(meta, data, viewer), [meta, data, viewer]);
  const evalCtx = useMemo(() => ({ ...ctx, properties: meta.properties }), [ctx, meta.properties]);
  const cardProps = useMemo(
    () => cardProperties(view, meta.properties, data.propertyIds),
    [view, meta.properties, data.propertyIds],
  );
  // A board without a grouping shows its rows in one column.
  const ungrouped = data.groups === null;
  const groups = useMemo<QueryGroup[]>(
    () =>
      data.groups ?? [
        {
          key: '',
          label: view.name,
          hidden: false,
          collapsedKey: '',
          count: data.count,
          totals: data.totals,
          rows: data.rows,
          nextCursor: data.nextCursor,
        },
      ],
    [data, view.name],
  );
  const { shown: columns, hidden: hiddenColumns } = boardColumns(groups);
  const lanes = boardLanes(data.lanes);
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const laneByKey = new Map((lanes ?? []).map((l) => [l.key, l]));
  const { collapsed, toggle } = useCollapsed(collapsedKey(meta.id, view.id, viewer.userId));
  const canAdd =
    !readOnly &&
    can('add_rows', meta.viewerAccess, { locked: meta.locked, canAddRows: meta.viewerCanAddRows });
  const canMove = !readOnly;
  const titleProperty = meta.properties.find((p) => p.config.type === 'title');
  const wrap = view.wrapText ?? false;
  const width = COLUMN_WIDTH[options.cardSize];

  const [created, setCreated] = useState<readonly Created[]>([]);
  const [naming, setNaming] = useState<Id | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [notice, setNotice] = useState('');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusCard = (rowId: Id, slot: Slot) =>
    setFocusRequest({ rowId, slot: slotKey(slot), data });
  const root = useRef<HTMLDivElement>(null);

  // Cards made here leave the local list once the answer has them.
  useEffect(() => {
    setCreated((list) => {
      const next = list.filter((c) => !inAnswer(data, c.row.id));
      return next.length === list.length ? list : next;
    });
  }, [data]);

  // Focus goes to a card once it's drawn where it went (after a move, a menu or a new title). A
  // moved card may only reach its new place with the next answer; once that's in, any copy will do.
  useEffect(() => {
    if (!focusRequest) return;
    const settled = focusRequest.data !== data && !data.refreshing;
    const card = findCard(root.current, focusRequest, settled);
    if (!card) return;
    card.focus();
    setFocusRequest(null);
  }, [focusRequest, data, created]);

  const rowsIn = (slot: Slot): QueryRow[] => {
    const group = groupByKey.get(slot.groupKey);
    const rows = group ? slotRows(group, slot.laneKey).rows : [];
    const ids = new Set(rows.map((r) => r.id));
    const extra = created.filter((c) => sameSlot(c.slot, slot) && !ids.has(c.row.id));
    return [...rows, ...extra.map((c) => c.row)];
  };
  const hiddenIds = new Set(
    created.filter((c) => c.data !== data && !data.refreshing).map((c) => c.row.id),
  );
  const findRow = (rowId: Id, slot: Slot) => rowsIn(slot).find((r) => r.id === rowId);
  const laneCollapsed = (lane: QueryLane) => collapsed.has(laneCollapsedKey(lane.collapsedKey));

  const placeLabel = (slot: Slot) => {
    const column = groupByKey.get(slot.groupKey)?.label ?? view.name;
    const lane = slot.laneKey === undefined ? undefined : laneByKey.get(slot.laneKey)?.label;
    return lane === undefined ? column : BOARD_TEXT.inLane(column, lane);
  };

  // ------------------------------------------------------------ moves

  const move = (row: QueryRow, from: Slot, to: Slot, beforeRowId: Id | null) => {
    const same = sameSlot(from, to);
    // Sorted views keep their order: only moves to another column or lane do anything.
    if (same && view.sorts.length > 0) return;
    setNotice(BOARD_TEXT.moved(titleOf(row), placeLabel(to)));
    if (!same) {
      setCreated((list) =>
        list.map((c) => (c.row.id === row.id && sameSlot(c.slot, from) ? { ...c, slot: to } : c)),
      );
    }
    actions
      .moveRow(row.id, ungrouped ? { beforeRowId } : rowPlace(from, to, beforeRowId))
      .catch(() => undefined);
  };

  const allowed = (rowId: Id, from: Slot, to: Slot) => {
    const row = findRow(rowId, from);
    if (!row || !canMove) return false;
    const lane = to.laneKey === undefined ? undefined : laneByKey.get(to.laneKey);
    if (lane && laneCollapsed(lane)) return false;
    return canMoveTo(row, view, from, to, evalCtx);
  };

  /** A drop right where the card is. */
  const unchanged = (rowId: Id, from: Slot, target: DropTarget) => {
    if (!sameSlot(from, target.slot)) return false;
    const rows = rowsIn(from);
    const at = rows.findIndex((r) => r.id === rowId);
    return (rows[at + 1]?.id ?? null) === target.beforeRowId;
  };

  const { drag, press, endedDrag } = useCardDrag({
    root,
    allowed,
    onDrop(rowId, from, target) {
      const row = findRow(rowId, from);
      if (row && !unchanged(rowId, from, target)) move(row, from, target.slot, target.beforeRowId);
    },
    onLongPress(rowId, from) {
      setMenuFor(cardKey(rowId, from));
    },
    onStart() {
      setMenuFor(null);
      setPicked(null);
    },
  });

  const dropAt = ((): { slot: string; beforeRowId: Id | null } | null => {
    if (drag?.target && !unchanged(drag.rowId, drag.from, drag.target))
      return { slot: slotKey(drag.target.slot), beforeRowId: drag.target.beforeRowId };
    if (picked && pickedMoved(picked)) {
      const beforeRowId = beforeRowAt(rowsIn(picked.to), picked.rowId, picked.index);
      return { slot: slotKey(picked.to), beforeRowId };
    }
    return null;
  })();

  // ------------------------------------------------------------ keyboard

  const pick = (row: QueryRow, slot: Slot) => {
    const index = rowsIn(slot).findIndex((r) => r.id === row.id);
    setPicked({ rowId: row.id, from: slot, fromIndex: index, to: slot, index });
    setNotice(BOARD_TEXT.pickedUp(titleOf(row)));
  };

  const cancelPick = (row: QueryRow) => {
    setPicked(null);
    setNotice(BOARD_TEXT.cancelled(titleOf(row)));
  };

  const drop = (row: QueryRow, at: Picked) => {
    setPicked(null);
    if (!pickedMoved(at)) {
      setNotice(BOARD_TEXT.cancelled(titleOf(row)));
      return;
    }
    move(row, at.from, at.to, beforeRowAt(rowsIn(at.to), row.id, at.index));
    focusCard(row.id, at.to);
  };

  const stepPick = (row: QueryRow, at: Picked, arrow: Arrow) => {
    const next = stepPicked(at, arrow, {
      columns: columns.map((g) => g.key),
      lanes: lanes ? lanes.map((l) => l.key) : [undefined],
      rowsIn,
      allowed: (to) => allowed(row.id, at.from, to),
    });
    if (!next) return;
    setPicked(next);
    const total = rowsIn(next.to).filter((r) => r.id !== row.id).length + 1;
    setNotice(BOARD_TEXT.movingTo(placeLabel(next.to), next.index + 1, total));
  };

  /** Arrow keys between cards: up and down in a column, left and right to the next column. */
  const focusNext = (from: HTMLElement, arrow: Arrow) => {
    const board = root.current;
    const slot = from.closest<HTMLElement>('[data-board-slot]');
    if (!board || !slot) return;
    const opens = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-card-open]')];
    const here = opens(slot);
    const at = here.indexOf(from);
    if (arrow === 'ArrowUp' || arrow === 'ArrowDown') {
      here[at + (arrow === 'ArrowUp' ? -1 : 1)]?.focus();
      return;
    }
    const row = [...board.querySelectorAll<HTMLElement>('[data-board-slot]')].filter(
      (el) => el.dataset.laneKey === slot.dataset.laneKey,
    );
    const step = arrow === 'ArrowLeft' ? -1 : 1;
    for (let i = row.indexOf(slot) + step; i >= 0 && i < row.length; i += step) {
      const cards = row[i] ? opens(row[i] as HTMLElement) : [];
      const card = cards[Math.min(at, cards.length - 1)];
      if (card) {
        card.focus();
        return;
      }
    }
  };

  const onCardKey = (event: KeyboardEvent<HTMLElement>, row: QueryRow, slot: Slot) => {
    if (picked && picked.rowId === row.id && sameSlot(picked.from, slot)) {
      if (event.key === ' ') {
        event.preventDefault();
        drop(row, picked);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelPick(row);
      } else if (isArrow(event.key)) {
        event.preventDefault();
        stepPick(row, picked, event.key);
      } else if (event.key === 'Tab') {
        cancelPick(row);
      }
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (canMove) pick(row, slot);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      actions.openRow(row.id);
    } else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      setMenuFor(cardKey(row.id, slot));
    } else if (isArrow(event.key)) {
      event.preventDefault();
      focusNext(event.currentTarget, event.key);
    }
  };

  // ------------------------------------------------------------ new cards and the card menu

  const addCard = async (slot: Slot) => {
    const before = data;
    const values = laneValues(view, slot.laneKey, evalCtx);
    const row = await actions
      .createRow({
        ...(ungrouped ? {} : { groupKey: slot.groupKey }),
        ...(values ? { values } : {}),
      })
      .catch(() => null);
    if (!row) return;
    setCreated((list) => [...list, { row: asQueryRow(row), slot, data: before }]);
    setNaming(row.id);
  };

  const nameCard = (row: QueryRow, slot: Slot, text: string | null) => {
    setNaming(null);
    focusCard(row.id, slot);
    const title = text?.trim() ?? '';
    if (!title || title === row.title || !titleProperty) return;
    setCreated((list) =>
      list.map((c) => (c.row.id === row.id ? { ...c, row: { ...c.row, title } } : c)),
    );
    actions.updateValues(row.id, { [titleProperty.id]: title }).catch(() => undefined);
  };

  const copyLink = (rowId: Id) => {
    const link = new URL(pageUrl(rowId), window.location.origin).href;
    const failed = () => toast({ title: BOARD_TEXT.linkNotCopied, variant: 'danger' });
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard.writeText(link).then(() => toast({ title: BOARD_TEXT.linkCopied }), failed);
  };

  const moveChoices = (row: QueryRow, from: Slot): MoveChoice[] => {
    if (ungrouped || !canMove) return [];
    return columns.flatMap((group) => {
      const to: Slot = { ...from, groupKey: group.key };
      if (group.key === from.groupKey || !canMoveTo(row, view, from, to, evalCtx)) return [];
      const onSelect = () => {
        // To the top of the column, where it's in sight.
        move(row, from, to, rowsIn(to).find((r) => r.id !== row.id)?.id ?? null);
        focusCard(row.id, to);
      };
      return [{ key: group.key, label: group.label, onSelect }];
    });
  };

  // ------------------------------------------------------------ drawing

  const renderCard = (row: QueryRow, slot: Slot) => {
    const key = cardKey(row.id, slot);
    const lifted = picked?.rowId === row.id && sameSlot(picked.from, slot);
    return (
      <BoardCard
        row={row}
        properties={cardProps}
        ctx={ctx}
        picture={cardPicture(row, options.cardPreview)}
        size={options.cardSize}
        fitImage={options.fitImage}
        showIcon={view.showPageIcon}
        wrap={wrap}
        hiddenByFilter={hiddenIds.has(row.id)}
        lifted={lifted}
        dragging={drag?.rowId === row.id && sameSlot(drag.from, slot)}
        naming={
          naming === row.id ? (
            <TitleInput
              label={titleProperty?.name ?? BOARD_TEXT.newTitle}
              initial={row.title}
              onDone={(text) => nameCard(row, slot, text)}
            />
          ) : undefined
        }
        menuOpen={menuFor === key}
        onMenuOpenChange={(open) => setMenuFor(open ? key : null)}
        onMenuClosed={() =>
          setFocusRequest((r) => r ?? { rowId: row.id, slot: slotKey(slot), data })
        }
        menu={{
          open: () => actions.openRow(row.id),
          moveTo: () => moveChoices(row, slot),
          duplicate: canAdd
            ? () => actions.duplicateRows([row.id]).catch(() => undefined)
            : undefined,
          copyLink: () => copyLink(row.id),
          delete: readOnly ? undefined : () => actions.trashRows([row.id]).catch(() => undefined),
        }}
        onPointerDown={(event) => {
          if (canMove) press(event, row.id, slot);
        }}
        onOpen={() => {
          if (!endedDrag()) actions.openRow(row.id);
        }}
        onKeyDown={(event) => onCardKey(event, row, slot)}
        onBlur={() => {
          if (lifted) cancelPick(row);
        }}
      />
    );
  };

  /** A slot's cards, then "Load more" and "+ New". */
  const slotBody = (group: QueryGroup, slot: Slot): ReactNode => {
    const key = slotKey(slot);
    const { nextCursor } = slotRows(group, slot.laneKey);
    const line = <div data-drop-indicator="" className="h-0.5 shrink-0 rounded-full bg-primary" />;
    return (
      <>
        {rowsIn(slot).map((row) => (
          <Fragment key={row.id}>
            {dropAt?.slot === key && dropAt.beforeRowId === row.id && line}
            {renderCard(row, slot)}
          </Fragment>
        ))}
        {dropAt?.slot === key && dropAt.beforeRowId === null && line}
        {nextCursor !== null && (
          <Button
            variant="ghost"
            size="sm"
            loading={data.loadingMore.includes(key)}
            onClick={() => {
              const loading = ungrouped
                ? actions.loadMore()
                : slot.laneKey === undefined
                  ? actions.loadMore(slot.groupKey)
                  : actions.loadMore(slot.groupKey, slot.laneKey);
              loading.catch(() => undefined);
            }}
            className="justify-start text-muted"
          >
            {BOARD_TEXT.loadMore}
          </Button>
        )}
        {canAdd && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void addCard(slot)}
            className="justify-start text-muted"
          >
            <Plus aria-hidden className="size-4" />
            {BOARD_TEXT.newCard}
          </Button>
        )}
      </>
    );
  };

  const columnClasses = (group: QueryGroup) =>
    cn(
      'flex shrink-0 flex-col gap-2 rounded p-2',
      width,
      options.colorColumns && group.color ? colorClasses[group.color].bg : 'bg-fill',
    );

  const columnHeader = (group: QueryGroup) => {
    const isCollapsed = collapsed.has(group.collapsedKey);
    return (
      <div className="flex min-w-0 items-center gap-1">
        <IconButton
          size="sm"
          label={isCollapsed ? BOARD_TEXT.expand(group.label) : BOARD_TEXT.collapse(group.label)}
          aria-expanded={!isCollapsed}
          onClick={() => toggle(group.collapsedKey)}
          className="shrink-0 text-muted"
        >
          {isCollapsed ? (
            <ChevronRight aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
        </IconButton>
        <span className={chipClasses(group.color)}>{group.label}</span>
        <span className="shrink-0 text-small text-muted">{group.header?.text ?? group.count}</span>
      </div>
    );
  };

  const hiddenList = hiddenColumns.length > 0 && (
    <section
      aria-label={BOARD_TEXT.hiddenGroups}
      className={cn('flex shrink-0 flex-col gap-1 p-2', width)}
    >
      <h3 className="px-1 text-small font-medium text-muted">{BOARD_TEXT.hiddenGroups}</h3>
      <ul className="flex flex-col gap-0.5">
        {hiddenColumns.map((group) => (
          <li key={group.key} className="flex min-w-0 items-center gap-2 px-1">
            <span className={chipClasses(group.color)}>{group.label}</span>
            <span className="text-small text-muted">{group.count}</span>
            {view.grouping && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={BOARD_TEXT.showGroup(group.label)}
                onClick={() => {
                  if (!view.grouping) return;
                  const grouping = withGroupShown(view.grouping, group.key);
                  actions.updateView({ grouping }).catch(() => undefined);
                }}
                className="ml-auto text-muted"
              >
                {BOARD_TEXT.show}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );

  const ghost = drag ? findRow(drag.rowId, drag.from) : undefined;

  return (
    <div ref={root} className="relative overflow-x-auto pb-2">
      {lanes ? (
        <div className="flex w-max flex-col gap-3">
          <div className="flex items-start gap-3">
            {columns.map((group) => (
              <div key={group.key} className={cn(columnClasses(group), 'py-1')}>
                {columnHeader(group)}
              </div>
            ))}
            {hiddenList}
          </div>
          {lanes.map((lane) => {
            const isCollapsed = laneCollapsed(lane);
            const label = isCollapsed
              ? BOARD_TEXT.expand(lane.label)
              : BOARD_TEXT.collapse(lane.label);
            return (
              <section key={lane.key} aria-label={lane.label} className="flex flex-col gap-2">
                <div className="sticky left-0 flex w-max items-center gap-1">
                  <IconButton
                    size="sm"
                    label={label}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggle(laneCollapsedKey(lane.collapsedKey))}
                    className="shrink-0 text-muted"
                  >
                    {isCollapsed ? (
                      <ChevronRight aria-hidden className="size-4" />
                    ) : (
                      <ChevronDown aria-hidden className="size-4" />
                    )}
                  </IconButton>
                  <span className={chipClasses(lane.color)}>{lane.label}</span>
                  <span className="text-small text-muted">{lane.count}</span>
                </div>
                {!isCollapsed && (
                  <div className="flex items-start gap-3">
                    {columns.map((group) => {
                      const slot = { groupKey: group.key, laneKey: lane.key };
                      return (
                        <div
                          key={group.key}
                          role="group"
                          aria-label={BOARD_TEXT.inLane(group.label, lane.label)}
                          data-testid="board-column"
                          data-board-slot={slotKey(slot)}
                          data-group-key={group.key}
                          data-lane-key={lane.key}
                          className={columnClasses(group)}
                        >
                          {!collapsed.has(group.collapsedKey) && slotBody(group, slot)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="flex w-max items-start gap-3">
          {columns.map((group) => {
            const slot = { groupKey: group.key };
            return (
              <section
                key={group.key}
                aria-label={group.label}
                data-testid="board-column"
                data-board-slot={slotKey(slot)}
                data-group-key={group.key}
                className={columnClasses(group)}
              >
                {!ungrouped && columnHeader(group)}
                {!collapsed.has(group.collapsedKey) && slotBody(group, slot)}
              </section>
            );
          })}
          {hiddenList}
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {notice}
      </div>
      {drag && ghost && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 truncate rounded border border-border bg-bg p-2 text-body font-medium shadow-menu"
          style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.width }}
        >
          {titleOf(ghost)}
        </div>
      )}
    </div>
  );
}

/** The title of a new card, typed in place: Enter or leaving saves it, Escape keeps "Untitled". */
function TitleInput({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone(title: string | null): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <Input
      ref={input}
      aria-label={label}
      defaultValue={initial}
      placeholder={CELL_TEXT.untitled}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-8 min-w-0 flex-1"
    />
  );
}
