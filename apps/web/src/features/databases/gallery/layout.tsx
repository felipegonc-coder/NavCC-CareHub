import { useMemo, type CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { Button, cn } from '@carehub/ui';
import type { LayoutProps, QueryGroup, QueryRow } from '../contract';
import { galleryOptions } from '../filters/layout-model';
import { BoardCard } from '../board/card';
import { allRows, cardsIn, useCards } from '../board/cards';
import { collapsedKey, useCollapsed } from '../board/collapsed';
import { GroupHeading } from '../board/group-heading';
import { BOARD_TEXT } from '../board/messages';
import {
  cardPicture,
  cardProperties,
  shownGroups,
  slotKey,
  stepAlong,
  type Arrow,
  type Slot,
} from '../board/model';

/** The narrowest a card gets for each card size, in px: the grid fits as many as it can. */
const CARD_WIDTH = { s: 180, m: 240, l: 320 } as const;

const CARD = 'article[data-row-id]';

/** How many cards stand on the first line of a slot's grid: how far ↑ and ↓ go. */
function perLine(slot: HTMLElement | null): number {
  const cards = slot ? [...slot.querySelectorAll<HTMLElement>(CARD)] : [];
  const top = cards[0]?.getBoundingClientRect().top;
  return Math.max(1, cards.filter((card) => card.getBoundingClientRect().top === top).length);
}

/** Arrow keys between cards: ← and → in reading order, ↑ and ↓ a line, then the next group. */
function focusNext(root: HTMLElement, from: HTMLElement, arrow: Arrow) {
  const all = cardsIn(root);
  if (arrow === 'ArrowLeft' || arrow === 'ArrowRight') {
    all[all.indexOf(from) + (arrow === 'ArrowLeft' ? -1 : 1)]?.focus();
    return;
  }
  const slot = from.closest<HTMLElement>('[data-board-slot]');
  if (!slot) return;
  const here = cardsIn(slot);
  const at = here.indexOf(from);
  const line = perLine(slot);
  const up = arrow === 'ArrowUp';
  const lastLine = Math.floor((here.length - 1) / line);
  const target = up
    ? here[at - line]
    : (here[at + line] ?? (Math.floor(at / line) < lastLine ? here[here.length - 1] : undefined));
  if (target) {
    target.focus();
    return;
  }
  const slots = [...root.querySelectorAll<HTMLElement>('[data-board-slot]')];
  const next = slots[slots.indexOf(slot) + (up ? -1 : 1)];
  const cards = next ? cardsIn(next) : [];
  (up ? cards[cards.length - 1] : cards[0])?.focus();
}

/**
 * The gallery (spec: Gallery): cards in a grid, with the view's picture, card size and properties,
 * in sections when the view is grouped. Cards move by drag, by keyboard (Space, arrows, Space) and,
 * between groups, with "Move to…".
 */
export default function GalleryLayout(props: LayoutProps) {
  const { meta, view, data, viewer } = props;
  const options = galleryOptions(view, meta.properties);
  const cardProps = useMemo(
    () => cardProperties(view, meta.properties, data.propertyIds),
    [view, meta.properties, data.propertyIds],
  );
  const ungrouped = data.groups === null;
  const groups = useMemo(
    () => (data.groups ? shownGroups(data.groups, view.grouping) : [allRows(data, view.name)]),
    [data, view.name, view.grouping],
  );
  const { collapsed, toggle } = useCollapsed(collapsedKey(meta.id, view.id, viewer.userId));
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const isOpen = (slot: Slot) => {
    const group = groupByKey.get(slot.groupKey);
    return group !== undefined && (ungrouped || !collapsed.has(group.collapsedKey));
  };

  const cards = useCards(props, {
    groups,
    ungrouped,
    placeLabel: (slot) => groupByKey.get(slot.groupKey)?.label ?? view.name,
    open: isOpen,
    step: (picked, arrow, at) =>
      stepAlong(picked, arrow, {
        ...at,
        slots: groups.map((g) => g.key),
        perLine: perLine(at.slotElement(picked.to)),
        sideways: true,
      }),
    focusNext,
    arrangement: 'grid',
  });
  const { dropAt } = cards;
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${CARD_WIDTH[options.cardSize]}px), 1fr))`,
  };

  /** A card, with the drop line on its left (it lands before) or, at the end, on its right. */
  const renderCard = (row: QueryRow, slot: Slot, line: 'before' | 'after' | null) => {
    return (
      <div key={row.id} className="relative flex min-w-0 flex-col">
        {line && (
          <div
            data-drop-indicator=""
            className={cn(
              'absolute inset-y-0 w-0.5 rounded-full bg-primary',
              line === 'before' ? '-left-2' : '-right-2',
            )}
          />
        )}
        <BoardCard
          row={row}
          properties={cardProps}
          ctx={cards.ctx}
          picture={cardPicture(row, options.cardPreview)}
          size={options.cardSize}
          fitImage={options.fitImage}
          showIcon={view.showPageIcon}
          showTitle={view.showTitle !== false}
          wrap={view.wrapText ?? false}
          {...cards.handlers(row, slot)}
        />
      </div>
    );
  };

  /** A group's grid of cards, then "+ New" and "Load more". */
  const slotBody = (group: QueryGroup) => {
    const slot: Slot = { groupKey: group.key };
    const key = slotKey(slot);
    const rows = cards.rowsIn(slot);
    const here = dropAt?.slot === key ? dropAt : null;
    const lineAt = (row: QueryRow, i: number) =>
      here?.beforeRowId === row.id
        ? 'before'
        : here?.beforeRowId === null && i === rows.length - 1
          ? 'after'
          : null;
    return (
      <>
        <div
          data-board-slot={key}
          data-group-key={group.key}
          className="grid items-start gap-3"
          style={grid}
        >
          {rows.map((row, i) => renderCard(row, slot, lineAt(row, i)))}
          {cards.canAdd && (
            <Button
              variant="ghost"
              onClick={() => void cards.addCard(slot)}
              className={cn(
                'min-h-20 border border-dashed border-border text-muted',
                rows.length === 0 && 'justify-start',
              )}
            >
              <Plus aria-hidden className="size-4" />
              {BOARD_TEXT.newCard}
            </Button>
          )}
        </div>
        {group.nextCursor !== null && (
          <Button
            variant="ghost"
            size="sm"
            loading={data.loadingMore.includes(key)}
            onClick={() => cards.loadMore(slot)}
            className="self-start text-muted"
          >
            {BOARD_TEXT.loadMore}
          </Button>
        )}
      </>
    );
  };

  return (
    <div ref={cards.root} className="relative flex flex-col gap-4 pb-2">
      {ungrouped
        ? groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              {slotBody(group)}
            </div>
          ))
        : groups.map((group) => {
            const isCollapsed = collapsed.has(group.collapsedKey);
            return (
              <section
                key={group.key}
                aria-label={group.label}
                data-testid="gallery-group"
                data-group-key={group.key}
                className="flex flex-col gap-2"
              >
                <GroupHeading
                  group={group}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(group.collapsedKey)}
                />
                {!isCollapsed && slotBody(group)}
              </section>
            );
          })}
      {cards.overlay}
    </div>
  );
}
