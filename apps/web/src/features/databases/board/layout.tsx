import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { Grouping } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { Button, cn, colorClasses, IconButton, useMediaQuery } from '@carehub/ui';
import type { LayoutProps, QueryGroup, QueryLane, QueryRow } from '../contract';
import { withGroupHidden, withGroupMoved } from '../filters/group-model';
import { boardOptions } from '../filters/layout-model';
import { BoardCard } from './card';
import { allRows, cardsIn, useCards } from './cards';
import { collapsedKey, laneCollapsedKey, useCollapsed } from './collapsed';
import { ColumnMenu } from './column-menu';
import { chipClasses } from './group-heading';
import { BOARD_TEXT } from './messages';
import {
  boardColumns,
  boardLanes,
  cardPicture,
  cardProperties,
  PHONE,
  slotKey,
  slotRows,
  stepPicked,
  withGroupShown,
  type Arrow,
  type Slot,
} from './model';

const COLUMN_WIDTH = { s: 'w-56', m: 'w-64', l: 'w-80' } as const;

/** Arrow keys between cards: up and down in a column, left and right to the next column. */
function focusNext(board: HTMLElement, from: HTMLElement, arrow: Arrow) {
  const slot = from.closest<HTMLElement>('[data-board-slot]');
  if (!slot) return;
  const here = cardsIn(slot);
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
    const cards = row[i] ? cardsIn(row[i] as HTMLElement) : [];
    const card = cards[Math.min(at, cards.length - 1)];
    if (card) {
      card.focus();
      return;
    }
  }
}

/**
 * The board (spec: Board): a column per group of the view's grouping, split into lanes by its
 * sub-grouping. Cards move by drag, by keyboard (Space, arrows, Space) and with "Move to…". On
 * phones it shows one column at a time: swipe sideways, or pick a column above the board.
 */
export default function BoardLayout(props: LayoutProps) {
  const { meta, view, data, viewer, actions, readOnly } = props;
  const options = boardOptions(view, meta.properties);
  const cardProps = useMemo(
    () => cardProperties(view, meta.properties, data.propertyIds),
    [view, meta.properties, data.propertyIds],
  );
  // A board without a grouping shows its rows in one column.
  const ungrouped = data.groups === null;
  const groups = useMemo(() => data.groups ?? [allRows(data, view.name)], [data, view.name]);
  const { shown: columns, hidden: hiddenColumns } = boardColumns(groups, view.grouping);
  const lanes = boardLanes(data.lanes, view.subGrouping);
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const laneByKey = new Map((lanes ?? []).map((l) => [l.key, l]));
  const { collapsed, toggle } = useCollapsed(collapsedKey(meta.id, view.id, viewer.userId));
  const laneCollapsed = (lane: QueryLane) => collapsed.has(laneCollapsedKey(lane.collapsedKey));
  const wrap = view.wrapText ?? false;
  const phone = useMediaQuery(PHONE);
  const width = phone ? 'w-full snap-start' : COLUMN_WIDTH[options.cardSize];
  const canEditViews = !readOnly && can('edit_views', meta.viewerAccess, { locked: meta.locked });
  const visible = useMemo(
    () => meta.properties.filter((p) => data.propertyIds.includes(p.id)),
    [meta.properties, data.propertyIds],
  );

  const cards = useCards(props, {
    groups: columns,
    ungrouped,
    placeLabel(slot) {
      const column = groupByKey.get(slot.groupKey)?.label ?? view.name;
      const lane = slot.laneKey === undefined ? undefined : laneByKey.get(slot.laneKey)?.label;
      return lane === undefined ? column : BOARD_TEXT.inLane(column, lane);
    },
    open(slot) {
      const lane = slot.laneKey === undefined ? undefined : laneByKey.get(slot.laneKey);
      return !lane || !laneCollapsed(lane);
    },
    step: (picked, arrow, at) =>
      stepPicked(picked, arrow, {
        ...at,
        columns: columns.map((g) => g.key),
        lanes: lanes ? lanes.map((l) => l.key) : [undefined],
      }),
    focusNext,
  });
  const { dropAt } = cards;

  // Phones: where each column starts, and the one in view.
  const heads = useRef(new Map<string, HTMLElement>());
  const headRef = (key: string) => (el: HTMLElement | null) => {
    if (el) heads.current.set(key, el);
    else heads.current.delete(key);
  };
  const [inView, setInView] = useState<string | null>(null);
  const shownKey = columns.some((g) => g.key === inView) ? inView : (columns[0]?.key ?? null);
  const trackColumn = () => {
    const board = cards.root.current;
    if (!board) return;
    const left = board.getBoundingClientRect().left;
    let nearest: string | null = null;
    let distance = Infinity;
    for (const group of columns) {
      const el = heads.current.get(group.key);
      const d = el ? Math.abs(el.getBoundingClientRect().left - left) : Infinity;
      if (d < distance) {
        nearest = group.key;
        distance = d;
      }
    }
    if (nearest !== null) setInView(nearest);
  };
  const showColumn = (key: string) => {
    setInView(key);
    heads.current
      .get(key)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  // The column menu: Hide, Move left and Move right change the grouping; Calculate the board.
  const changeGrouping = (grouping: Grouping) => {
    actions.updateView({ grouping }).catch(() => undefined);
  };
  const moveColumn = (group: QueryGroup, step: -1 | 1) => {
    const grouping = view.grouping;
    const next = columns[columns.indexOf(group) + step];
    if (!grouping || !next) return undefined;
    const keys = groups.map((g) => g.key);
    const from = keys.indexOf(group.key);
    return () => changeGrouping(withGroupMoved(grouping, keys, from, keys.indexOf(next.key)));
  };
  const columnMenu = (group: QueryGroup) => {
    const grouping = view.grouping;
    if (ungrouped || !grouping) return null;
    return (
      <ColumnMenu
        label={group.label}
        onHide={() => changeGrouping(withGroupHidden(grouping, group.key, true))}
        onMoveLeft={moveColumn(group, -1)}
        onMoveRight={moveColumn(group, 1)}
        calculation={
          canEditViews
            ? {
                current: options.headerCalculation,
                properties: visible,
                onChange: (headerCalculation) => {
                  actions
                    .updateView({ board: { ...options, headerCalculation } })
                    .catch(() => undefined);
                },
              }
            : undefined
        }
        className="ml-auto"
      />
    );
  };

  const renderCard = (row: QueryRow, slot: Slot) => (
    <BoardCard
      row={row}
      properties={cardProps}
      ctx={cards.ctx}
      picture={cardPicture(row, options.cardPreview)}
      size={options.cardSize}
      fitImage={options.fitImage}
      showIcon={view.showPageIcon}
      showTitle={view.showTitle !== false}
      wrap={wrap}
      {...cards.handlers(row, slot)}
    />
  );

  /** A slot's cards, then "Load more" and "+ New". */
  const slotBody = (group: QueryGroup, slot: Slot): ReactNode => {
    const key = slotKey(slot);
    const { nextCursor } = slotRows(group, slot.laneKey);
    const line = <div data-drop-indicator="" className="h-0.5 shrink-0 rounded-full bg-primary" />;
    return (
      <>
        {cards.rowsIn(slot).map((row) => (
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
            onClick={() => cards.loadMore(slot)}
            className="justify-start text-muted"
          >
            {BOARD_TEXT.loadMore}
          </Button>
        )}
        {cards.canAdd && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void cards.addCard(slot)}
            className="justify-start text-muted"
          >
            <Plus aria-hidden className="size-4" />
            {BOARD_TEXT.newCard}
          </Button>
        )}
      </>
    );
  };

  /** A collapsed column stands narrow, its label on its side (on phones it keeps the width). */
  const narrow = (group: QueryGroup) => !phone && collapsed.has(group.collapsedKey);
  const columnClasses = (group: QueryGroup) =>
    cn(
      'flex shrink-0 flex-col gap-2 rounded p-2',
      narrow(group) ? 'w-10 items-center' : width,
      options.colorColumns && group.color ? colorClasses[group.color].bg : 'bg-fill',
    );

  const columnHeader = (group: QueryGroup) => {
    const isCollapsed = collapsed.has(group.collapsedKey);
    const sideways = narrow(group) ? { writingMode: 'vertical-rl' as const } : undefined;
    return (
      <div className={cn('flex min-w-0 items-center gap-1', narrow(group) && 'flex-col')}>
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
        <span className={chipClasses(group.color)} style={sideways}>
          {group.label}
        </span>
        <span className="shrink-0 text-small text-muted" style={sideways}>
          {group.header?.text ?? group.count}
        </span>
        {!narrow(group) && columnMenu(group)}
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

  const picker = phone && !ungrouped && columns.length > 1 && (
    <div role="group" aria-label={BOARD_TEXT.columns} className="flex gap-1 overflow-x-auto pb-2">
      {columns.map((group) => (
        <Button
          key={group.key}
          variant="ghost"
          size="sm"
          aria-current={group.key === shownKey ? 'true' : undefined}
          onClick={() => showColumn(group.key)}
          className={cn('shrink-0', group.key === shownKey && 'bg-fill')}
        >
          <span className={chipClasses(group.color)}>{group.label}</span>
          <span className="text-small text-muted">{group.count}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <>
      {picker}
      <div
        ref={cards.root}
        onScroll={phone ? trackColumn : undefined}
        className={cn(
          'relative overflow-x-auto pb-2',
          // Swipes stop at each column; not while a card is dragged, so the board can scroll by it.
          phone && !cards.dragging && 'snap-x snap-mandatory',
        )}
      >
        {lanes ? (
          <div className={cn('flex flex-col gap-3', phone ? 'w-full' : 'w-max')}>
            <div className="flex items-start gap-3">
              {columns.map((group) => (
                <div
                  key={group.key}
                  ref={headRef(group.key)}
                  className={cn(columnClasses(group), 'py-1')}
                >
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
          <div className={cn('flex items-start gap-3', phone ? 'w-full' : 'w-max')}>
            {columns.map((group) => {
              const slot = { groupKey: group.key };
              return (
                <section
                  key={group.key}
                  ref={headRef(group.key)}
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
        {cards.overlay}
      </div>
    </>
  );
}
