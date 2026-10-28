import { Fragment, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Id } from '@carehub/databases';
import type { ViewTotal } from '@carehub/databases/aggregate';
import { Button } from '@carehub/ui';
import type { LayoutProps, QueryGroup, QueryRow } from '../contract';
import { allRows, cardsIn, useCards } from '../board/cards';
import { collapsedKey, useCollapsed } from '../board/collapsed';
import { GroupHeading } from '../board/group-heading';
import { BOARD_TEXT } from '../board/messages';
import {
  cardProperties,
  shownGroups,
  slotKey,
  stepAlong,
  type Arrow,
  type Slot,
} from '../board/model';
import { ListRow } from './row';

/** ↑ and ↓ move between lines, across groups. */
function focusNext(root: HTMLElement, from: HTMLElement, arrow: Arrow) {
  if (arrow !== 'ArrowUp' && arrow !== 'ArrowDown') return;
  const all = cardsIn(root);
  all[all.indexOf(from) + (arrow === 'ArrowUp' ? -1 : 1)]?.focus();
}

/**
 * The list (spec: List): one line per row with its icon, title and the view's properties on the
 * right, in collapsible groups with counts and calculations when the view is grouped. Sub-items
 * stand in under their parent, whose arrow shows or hides them. Lines move by drag, by keyboard
 * (Space, arrows, Space) and, between groups, with "Move to…".
 */
export default function ListLayout(props: LayoutProps) {
  const { meta, view, data, viewer } = props;
  const properties = useMemo(
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
  const propertyById = new Map(meta.properties.map((p) => [p.id, p]));

  const cards = useCards(props, {
    groups,
    ungrouped,
    placeLabel: (slot) => groupByKey.get(slot.groupKey)?.label ?? view.name,
    open(slot) {
      const group = groupByKey.get(slot.groupKey);
      return group !== undefined && (ungrouped || !collapsed.has(group.collapsedKey));
    },
    step: (picked, arrow, at) =>
      stepAlong(picked, arrow, {
        ...at,
        slots: groups.map((g) => g.key),
        perLine: 1,
        sideways: false,
      }),
    focusNext,
    item: 'li[data-row-id]',
  });
  const { dropAt } = cards;

  // Sub-items (nested): the lines under a parent whose arrow is closed are left out.
  const [folded, setFolded] = useState<ReadonlySet<Id>>(() => new Set());
  const fold = (rowId: Id, open: boolean) =>
    setFolded((was) => {
      const next = new Set(was);
      if (open) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  const unfolded = (rows: readonly QueryRow[]): QueryRow[] => {
    const gone = new Set<Id>();
    return rows.filter((row) => {
      const under = row.parentId ? gone.has(row.parentId) || folded.has(row.parentId) : false;
      if (under) gone.add(row.id);
      return !under;
    });
  };

  /** The view's calculations (section 3.11), each after its property's name. */
  const totalsLine = (totals: Partial<Record<Id, ViewTotal>>) => {
    const shown = Object.entries(totals).flatMap(([id, total]) => {
      const property = propertyById.get(id);
      return property && total ? [{ property, total }] : [];
    });
    if (shown.length === 0) return null;
    return (
      <dl className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1 text-label text-muted">
        {shown.map(({ property, total }) => (
          <div key={property.id} data-property-id={property.id} className="flex min-w-0 gap-1">
            <dt className="truncate">{property.name}</dt>
            <dd className="shrink-0 text-fg">{total.text}</dd>
          </div>
        ))}
      </dl>
    );
  };

  /** A group's lines, then "Load more", "+ New" and its calculations. */
  const slotBody = (group: QueryGroup) => {
    const slot: Slot = { groupKey: group.key };
    const key = slotKey(slot);
    const line = (
      <li aria-hidden data-drop-indicator="" className="h-0.5 shrink-0 rounded-full bg-primary" />
    );
    return (
      <>
        <ul
          data-board-slot={key}
          data-group-key={group.key}
          aria-label={ungrouped ? view.name : undefined}
          className="flex min-h-2 flex-col"
        >
          {unfolded(cards.rowsIn(slot)).map((row) => (
            <Fragment key={row.id}>
              {dropAt?.slot === key && dropAt.beforeRowId === row.id && line}
              <ListRow
                row={row}
                properties={properties}
                ctx={cards.ctx}
                showIcon={view.showPageIcon}
                showTitle={view.showTitle !== false}
                wrap={view.wrapText ?? false}
                expanded={(row.childCount ?? 0) > 0 ? !folded.has(row.id) : undefined}
                onExpandedChange={(open) => fold(row.id, open)}
                {...cards.handlers(row, slot)}
              />
            </Fragment>
          ))}
          {dropAt?.slot === key && dropAt.beforeRowId === null && line}
        </ul>
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
        {cards.canAdd && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void cards.addCard(slot)}
            className="self-start text-muted max-md:min-h-11"
          >
            <Plus aria-hidden className="size-4" />
            {BOARD_TEXT.newCard}
          </Button>
        )}
        {!ungrouped && totalsLine(group.totals)}
      </>
    );
  };

  return (
    <div ref={cards.root} className="relative flex flex-col gap-3 pb-2">
      {ungrouped
        ? groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              {slotBody(group)}
            </div>
          ))
        : groups.map((group) => {
            const isCollapsed = collapsed.has(group.collapsedKey);
            return (
              <section
                key={group.key}
                aria-label={group.label}
                data-testid="list-group"
                data-group-key={group.key}
                className="flex flex-col"
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
      {totalsLine(data.totals)}
      {cards.overlay}
    </div>
  );
}
