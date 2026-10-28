/**
 * What the board, the gallery and the list share: cards (or lines) made here until the answer has
 * them, moving them by drag, keyboard (Space, arrows, Space) and "Move to…", naming new ones, their
 * menus, and what's read out. Each layout draws its own slots and gives the moves it allows.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { Id } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { pageUrl } from '@carehub/shared';
import { useToast } from '@carehub/ui';
import { CELL_TEXT } from '../cells';
import {
  cellContext,
  type LayoutProps,
  type QueryGroup,
  type QueryRow,
  type ViewData,
} from '../contract';
import type { CardMenuActions, MoveChoice } from './card';
import { useCardDrag, type Arrangement, type DropTarget } from './drag';
import { BOARD_TEXT } from './messages';
import {
  asQueryRow,
  beforeRowAt,
  canMoveTo,
  inAnswer,
  isArrow,
  laneValues,
  rowPlace,
  sameSlot,
  slotKey,
  slotRows,
  type Arrow,
  type Picked,
  type Slot,
} from './model';
import { TitleInput } from './title-input';

/** A card made here, shown until the answer has it ("Hidden by filter" if a newer one doesn't). */
interface Created {
  row: QueryRow;
  slot: Slot;
  data: ViewData;
}

export const titleOf = (row: QueryRow) => row.title || CELL_TEXT.untitled;
const cardKey = (rowId: Id, slot: Slot) => `${slotKey(slot)}\n${rowId}`;

/** A view's rows without a grouping, as one group with the key ''. */
export function allRows(data: ViewData, label: string): QueryGroup {
  return {
    key: '',
    label,
    hidden: false,
    collapsedKey: '',
    count: data.count,
    totals: data.totals,
    rows: data.rows,
    nextCursor: data.nextCursor,
  };
}

/** The cards' focusable parts in a slot, or in the whole layout. */
export const cardsIn = (el: HTMLElement): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>('[data-card-open]'),
];

/** A card to focus once it's drawn in a slot, asked for while the view showed `data`. */
interface FocusRequest {
  rowId: Id;
  slot: string;
  data: ViewData;
}

/** The focusable part of a card or line: in the slot, or with `anywhere`, wherever it is. */
function findCard(
  root: HTMLElement | null,
  { rowId, slot }: FocusRequest,
  anywhere: boolean,
): HTMLElement | null {
  if (!root) return null;
  const all = cardsIn(root).filter(
    (el) => el.closest<HTMLElement>('[data-row-id]')?.dataset.rowId === rowId,
  );
  const here = all.find(
    (el) => el.closest<HTMLElement>('[data-board-slot]')?.dataset.boardSlot === slot,
  );
  return here ?? (anywhere ? (all[0] ?? null) : null);
}

/** What a keyboard move may ask about the layout. */
export interface StepContext {
  rowsIn(slot: Slot): readonly QueryRow[];
  allowed(slot: Slot): boolean;
  /** Where the slot is drawn, if it is. */
  slotElement(slot: Slot): HTMLElement | null;
}

/** The element drawn for a slot ([data-board-slot]). */
export function slotElement(root: HTMLElement | null, slot: Slot): HTMLElement | null {
  const key = slotKey(slot);
  const all = root ? [...root.querySelectorAll<HTMLElement>('[data-board-slot]')] : [];
  return all.find((el) => el.dataset.boardSlot === key) ?? null;
}

export interface CardsSetup {
  /** The groups shown, in order (allRows without a grouping). */
  groups: readonly QueryGroup[];
  ungrouped: boolean;
  /** How a place is read out: "Done", or "Done, High" in a lane. */
  placeLabel(slot: Slot): string;
  /** Whether a slot takes cards now (a collapsed lane doesn't). */
  open?(slot: Slot): boolean;
  /** Where an arrow takes a picked-up card; null: no further. */
  step(picked: Picked, arrow: Arrow, at: StepContext): Picked | null;
  /** Arrow keys between cards, from the focused one. */
  focusNext(root: HTMLElement, from: HTMLElement, arrow: Arrow): void;
  /** The cards in a slot, for dragging. Default: articles. */
  item?: string;
  arrangement?: Arrangement;
}

/** What a card or line gets from useCards. */
export interface CardHandlers {
  hiddenByFilter: boolean;
  /** Picked up with Space. */
  lifted: boolean;
  /** Being dragged. */
  dragging: boolean;
  /** The title box of a new card, in place of its title. */
  naming?: ReactNode;
  menuOpen: boolean;
  onMenuOpenChange(open: boolean): void;
  onMenuClosed(): void;
  menu: CardMenuActions;
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onBlur(): void;
}

export function useCards(props: LayoutProps, setup: CardsSetup) {
  const { meta, view, data, viewer, actions, readOnly } = props;
  const { groups, ungrouped } = setup;
  const { toast } = useToast();
  const ctx = useMemo(() => cellContext(meta, data, viewer), [meta, data, viewer]);
  const evalCtx = useMemo(() => ({ ...ctx, properties: meta.properties }), [ctx, meta.properties]);
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const canAdd =
    !readOnly &&
    can('add_rows', meta.viewerAccess, { locked: meta.locked, canAddRows: meta.viewerCanAddRows });
  const canMove = !readOnly;
  // Sorted views keep their order: cards only move to another group.
  const sorted = view.sorts.length > 0;
  const canPick = canMove && !(ungrouped && sorted);
  const titleProperty = meta.properties.find((p) => p.config.type === 'title');

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

  // ------------------------------------------------------------ moves

  const move = (row: QueryRow, from: Slot, to: Slot, beforeRowId: Id | null) => {
    const same = sameSlot(from, to);
    if (same && sorted) return;
    setNotice(BOARD_TEXT.moved(titleOf(row), setup.placeLabel(to)));
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
    if (setup.open && !setup.open(to)) return false;
    return canMoveTo(row, view, from, to, evalCtx);
  };

  /** A drop that changes nothing: where the card is, or within its group in a sorted view. */
  const unchanged = (rowId: Id, from: Slot, target: DropTarget) => {
    if (!sameSlot(from, target.slot)) return false;
    if (sorted) return true;
    const rows = rowsIn(from);
    const at = rows.findIndex((r) => r.id === rowId);
    return (rows[at + 1]?.id ?? null) === target.beforeRowId;
  };
  const changes = (at: Picked) =>
    !sameSlot(at.from, at.to) || (!sorted && at.index !== at.fromIndex);

  const { drag, press, endedDrag } = useCardDrag({
    root,
    item: setup.item,
    arrangement: setup.arrangement,
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

  /** Where the drop line goes: the slot, and the card it's drawn before (null: the end). */
  const dropAt = ((): { slot: string; beforeRowId: Id | null } | null => {
    if (drag?.target && !unchanged(drag.rowId, drag.from, drag.target))
      return { slot: slotKey(drag.target.slot), beforeRowId: drag.target.beforeRowId };
    if (picked && changes(picked)) {
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
    if (!changes(at)) {
      setNotice(BOARD_TEXT.cancelled(titleOf(row)));
      return;
    }
    move(row, at.from, at.to, beforeRowAt(rowsIn(at.to), row.id, at.index));
    focusCard(row.id, at.to);
  };

  const stepPick = (row: QueryRow, at: Picked, arrow: Arrow) => {
    const grid: StepContext = {
      rowsIn,
      allowed: (to) => allowed(row.id, at.from, to),
      slotElement: (slot) => slotElement(root.current, slot),
    };
    let next = setup.step(at, arrow, grid);
    // In a sorted view, places within a group don't count: the card goes on to the next group.
    while (next && sorted && sameSlot(next.to, at.to)) next = setup.step(next, arrow, grid);
    if (!next) return;
    setPicked(next);
    const total = rowsIn(next.to).filter((r) => r.id !== row.id).length + 1;
    setNotice(BOARD_TEXT.movingTo(setup.placeLabel(next.to), next.index + 1, total));
  };

  const onKey = (event: KeyboardEvent<HTMLElement>, row: QueryRow, slot: Slot) => {
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
      if (canPick) pick(row, slot);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      actions.openRow(row.id);
    } else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      setMenuFor(cardKey(row.id, slot));
    } else if (isArrow(event.key)) {
      event.preventDefault();
      if (root.current) setup.focusNext(root.current, event.currentTarget, event.key);
    }
  };

  // ------------------------------------------------------------ new cards, Load more, the menu

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

  const loadMore = (slot: Slot) => {
    const loading = ungrouped
      ? actions.loadMore()
      : slot.laneKey === undefined
        ? actions.loadMore(slot.groupKey)
        : actions.loadMore(slot.groupKey, slot.laneKey);
    loading.catch(() => undefined);
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
    return groups.flatMap((group) => {
      const to: Slot = { ...from, groupKey: group.key };
      if (group.key === from.groupKey || !canMoveTo(row, view, from, to, evalCtx)) return [];
      const onSelect = () => {
        // To the top of the group, where it's in sight.
        move(row, from, to, rowsIn(to).find((r) => r.id !== row.id)?.id ?? null);
        focusCard(row.id, to);
      };
      return [{ key: group.key, label: group.label, onSelect }];
    });
  };

  /** Everything a card or line needs: its state, its menu and its handlers. */
  const handlers = (row: QueryRow, slot: Slot): CardHandlers => {
    const key = cardKey(row.id, slot);
    const lifted = picked?.rowId === row.id && sameSlot(picked.from, slot);
    return {
      hiddenByFilter: hiddenIds.has(row.id),
      lifted,
      dragging: drag?.rowId === row.id && sameSlot(drag.from, slot),
      naming:
        naming === row.id ? (
          <TitleInput
            label={titleProperty?.name ?? BOARD_TEXT.newTitle}
            initial={row.title}
            onDone={(text) => nameCard(row, slot, text)}
          />
        ) : undefined,
      menuOpen: menuFor === key,
      onMenuOpenChange: (open) => setMenuFor(open ? key : null),
      onMenuClosed: () => setFocusRequest((r) => r ?? { rowId: row.id, slot: slotKey(slot), data }),
      menu: {
        open: () => actions.openRow(row.id),
        moveTo: () => moveChoices(row, slot),
        duplicate: canAdd
          ? () => actions.duplicateRows([row.id]).catch(() => undefined)
          : undefined,
        copyLink: () => copyLink(row.id),
        delete: readOnly ? undefined : () => actions.trashRows([row.id]).catch(() => undefined),
      },
      onPointerDown: (event) => {
        if (canPick) press(event, row.id, slot);
      },
      onOpen: () => {
        if (!endedDrag()) actions.openRow(row.id);
      },
      onKeyDown: (event) => onKey(event, row, slot),
      onBlur: () => {
        if (lifted) cancelPick(row);
      },
    };
  };

  const dragged = drag ? findRow(drag.rowId, drag.from) : undefined;
  /** What's read out (moves), and the card under the pointer while it's dragged. */
  const overlay = (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {notice}
      </div>
      {drag && dragged && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 truncate rounded border border-border bg-bg p-2 text-body font-medium shadow-menu"
          style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.width }}
        >
          {titleOf(dragged)}
        </div>
      )}
    </>
  );

  return {
    ctx,
    evalCtx,
    canAdd,
    root,
    rowsIn,
    dropAt,
    /** A card is being dragged. */
    dragging: drag !== null,
    handlers,
    addCard,
    loadMore,
    overlay,
  };
}
