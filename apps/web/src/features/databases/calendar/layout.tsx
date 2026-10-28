/**
 * The calendar layout (Databases spec 3.3): rows on the day of the view's date property, by month
 * or by week, from the viewer's week start. Drag a card to another day (a range keeps its length,
 * times keep their time), drag its end to change the end, or use "Move to date" in its menu.
 * Clicking an empty day, or Enter on a day, adds a row on that date. Rows without a date wait in
 * "No date".
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  addDays,
  formatTime,
  isValidDateValue,
  startOfWeek,
  todayIn,
  type CalendarDate,
  type DateValue,
  type Property,
} from '@carehub/databases';
import { Button, cn, IconButton, Popover, PopoverContent, PopoverTrigger } from '@carehub/ui';
import { rowCell } from '../cells';
import { cellContext, loadMoreKey, type LayoutProps, type QueryRow } from '../contract';
import { calendarOptions } from '../filters/layout-model';
import { CalendarCard, cardTitle, type DragKind } from './card';
import { CALENDAR_TEXT, dayName, dayNumber, monthTitle, weekdayShort, weekTitle } from './messages';
import {
  calendarWeeks,
  datedRow,
  DAY_ITEM_LIMIT,
  dayValue,
  itemsByDay,
  moveDateValue,
  moveStartTo,
  sameDateValue,
  stepAnchor,
  stepDay,
  visibleItems,
  weekdayOrder,
  withEndDay,
  type CalendarDay,
  type CalendarMode,
  type DatedRow,
  type DayItem,
} from './model';
import { dayAt, DRAG_START, followPointer, swallowNextClick } from './pointer';
import { MoveToDateDialog } from './move-dialog';

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const isArrow = (key: string): key is Arrow => ARROWS.has(key);

const ignore = () => undefined;

export default function CalendarLayout({
  meta,
  view,
  data,
  viewer,
  actions,
  readOnly,
}: LayoutProps) {
  const options = calendarOptions(view, meta.properties);
  const property = meta.properties.find((p) => p.id === options.showBy);
  // Created and edited times can be shown but not dragged (spec 3.3).
  const editable = !readOnly && property?.config.type === 'date';
  const today = todayIn(viewer);

  const [anchor, setAnchor] = useState<CalendarDate>(today);
  const [chosenMode, setChosenMode] = useState<CalendarMode | null>(null);
  const mode = chosenMode ?? options.mode;
  const [focusDate, setFocusDate] = useState<CalendarDate>(today);
  const [drag, setDrag] = useState<{ rowId: string; over: CalendarDate | null } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [noDateOpen, setNoDateOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<CalendarDate | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const titleId = useId();
  const noDateId = useId();

  useEffect(() => () => stopDrag.current?.(), []);

  const rows = useMemo(
    () => (data.groups ? data.groups.flatMap((g) => g.rows) : data.rows),
    [data.groups, data.rows],
  );
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const valueOf = (row: QueryRow): unknown => (property ? rowCell(row, property).value : null);
  const placed = useMemo(() => {
    const dated: DatedRow[] = [];
    const undated: QueryRow[] = [];
    for (const row of rows) {
      const place = property
        ? datedRow(row.id, rowCell(row, property).value, viewer.timeZone)
        : null;
      if (place) dated.push(place);
      else undated.push(row);
    }
    return { dated, undated };
  }, [rows, property, viewer.timeZone]);

  const weeks = calendarWeeks(anchor, mode, viewer.weekStart, today, options.showWeekends);
  const shownDays = weeks.flat();
  const byDay = itemsByDay(
    placed.dated,
    shownDays.map((d) => d.date),
  );
  const activeDate = shownDays.some((d) => d.date === focusDate)
    ? focusDate
    : (shownDays.find((d) => d.today)?.date ??
      shownDays.find((d) => d.inMonth)?.date ??
      shownDays[0]?.date);

  useEffect(() => {
    const date = pendingFocus.current;
    if (!date) return;
    pendingFocus.current = null;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  });

  const ctx = useMemo(() => cellContext(meta, data, viewer), [meta, data, viewer]);
  const propertiesById = useMemo(
    () => new Map(meta.properties.map((p) => [p.id, p])),
    [meta.properties],
  );
  const cardProperties = view.properties
    .filter((s) => s.visible)
    .map((s) => propertiesById.get(s.propertyId))
    .filter((p): p is Property => p !== undefined && p.config.type !== 'title');

  // ------------------------------------------------------------ changes

  const save = (row: QueryRow, next: DateValue, day: CalendarDate) => {
    if (!property) return;
    const before = datedValue(valueOf(row));
    if (before && sameDateValue(before, next)) return;
    setAnnouncement(CALENDAR_TEXT.moved(cardTitle(row), day));
    actions.updateValues(row.id, { [property.id]: next }).catch(ignore);
  };

  const drop = (rowId: string, from: CalendarDate | null, to: CalendarDate, kind: DragKind) => {
    const row = rowsById.get(rowId);
    if (!row) return;
    const value = datedValue(valueOf(row));
    if (!value) save(row, dayValue(to), to);
    else if (kind === 'end') save(row, withEndDay(value, to, viewer.timeZone), to);
    else if (from && from !== to) save(row, moveDateValue(value, from, to, viewer.timeZone), to);
  };

  const addRow = (date: CalendarDate) => {
    if (!editable || !property) return;
    actions.createRow({ values: { [property.id]: dayValue(date) } }).catch(ignore);
  };

  const startDrag = (
    event: PointerEvent<HTMLElement>,
    rowId: string,
    from: CalendarDate | null,
    kind: DragKind,
  ) => {
    // Phones change dates in the row, not by dragging (spec 3.3).
    if (!editable || event.button !== 0 || event.pointerType === 'touch') return;
    // No text selection while dragging; a click without a drag still opens the row.
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    stopDrag.current?.();
    stopDrag.current = followPointer({
      move: (spot) => {
        if (!active) {
          if (Math.abs(spot.x - startX) < DRAG_START && Math.abs(spot.y - startY) < DRAG_START) {
            return;
          }
          active = true;
        }
        setDrag({ rowId, over: dayAt(spot) });
      },
      escape: () => setDrag(null),
      end: (spot, cancelled) => {
        stopDrag.current = null;
        if (!active) return;
        swallowNextClick();
        setDrag(null);
        const to = cancelled ? null : dayAt(spot);
        if (to) drop(rowId, from, to, kind);
      },
    });
  };

  const moveFocus = (date: CalendarDate) => {
    setFocusDate(date);
    pendingFocus.current = date;
    if (!shownDays.some((d) => d.date === date)) setAnchor(date);
  };

  const changeMode = (next: CalendarMode) => {
    setChosenMode(next);
    if (next !== options.mode) {
      actions.updateView({ calendar: { ...options, mode: next } }).catch(ignore);
    }
  };

  // ------------------------------------------------------------ drawing

  const card = (row: QueryRow, item: DayItem | null, day: CalendarDate | null) => (
    <CalendarCard
      key={row.id}
      row={row}
      time={item?.time ? formatTime(item.time.hour, item.time.minute, viewer.hour12) : null}
      part={item?.part ?? 'single'}
      properties={cardProperties}
      ctx={ctx}
      showTitle={view.showTitle !== false}
      wrap={view.wrapText === true}
      editable={editable}
      dragging={drag?.rowId === row.id}
      onOpen={() => actions.openRow(row.id)}
      onPressStart={(event, kind) => startDrag(event, row.id, day, kind)}
      onMoveToDate={() => setMovingId(row.id)}
      {...(readOnly ? {} : { onDelete: () => void actions.trashRows([row.id]).catch(ignore) })}
    />
  );

  if (!property) {
    return (
      <div className="flex flex-col items-start gap-2 px-2 py-6">
        <p className="text-body text-muted">{CALENDAR_TEXT.noShowBy}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => actions.openPanel('layout', undefined, event.currentTarget)}
        >
          {CALENDAR_TEXT.chooseShowBy}
        </Button>
      </div>
    );
  }

  const weekFirst = startOfWeek(anchor, viewer.weekStart);
  const title = mode === 'month' ? monthTitle(anchor) : weekTitle(weekFirst, addDays(weekFirst, 6));
  const columns = options.showWeekends ? 'grid-cols-7' : 'grid-cols-5';
  const moving = movingId ? rowsById.get(movingId) : undefined;
  const movingValue = moving ? datedValue(valueOf(moving)) : null;
  const loadingMore = data.loadingMore.includes(loadMoreKey());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p id={titleId} className="text-body font-semibold">
          {title}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={noDateOpen}
            aria-controls={noDateId}
            onClick={() => setNoDateOpen((open) => !open)}
          >
            {CALENDAR_TEXT.noDate} <span className="text-muted">{placed.undated.length}</span>
          </Button>
          <div className="flex items-center" role="group" aria-label={CALENDAR_TEXT.view}>
            {(['month', 'week'] as const).map((m) => (
              <Button
                key={m}
                variant={mode === m ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={mode === m}
                onClick={() => changeMode(m)}
              >
                {CALENDAR_TEXT[m]}
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAnchor(today);
              setFocusDate(today);
            }}
          >
            {CALENDAR_TEXT.today}
          </Button>
          <IconButton
            size="sm"
            label={mode === 'month' ? CALENDAR_TEXT.previousMonth : CALENDAR_TEXT.previousWeek}
            onClick={() => setAnchor(stepAnchor(anchor, mode, -1))}
          >
            <ChevronLeft aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={mode === 'month' ? CALENDAR_TEXT.nextMonth : CALENDAR_TEXT.nextWeek}
            onClick={() => setAnchor(stepAnchor(anchor, mode, 1))}
          >
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="flex gap-2 max-md:flex-col">
        <div
          ref={gridRef}
          role="grid"
          aria-labelledby={titleId}
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-border"
        >
          <div role="row" className={cn('grid border-b border-border', columns)}>
            {weekdayOrder(viewer.weekStart, options.showWeekends).map((day) => (
              <div key={day} role="columnheader" className="px-2 py-1 text-label text-muted">
                {weekdayShort(day)}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div
              key={week[0]?.date}
              role="row"
              className={cn('grid border-b border-border last:border-b-0', columns)}
            >
              {week.map((day) => {
                const { shown, more } = visibleItems(
                  byDay.get(day.date) ?? [],
                  mode === 'month' ? DAY_ITEM_LIMIT : null,
                );
                const cardsOf = (items: readonly DayItem[]) =>
                  items.flatMap((item) => {
                    const row = rowsById.get(item.id);
                    return row ? [card(row, item, day.date)] : [];
                  });
                return (
                  <DayCell
                    key={day.date}
                    day={day}
                    mode={mode}
                    active={day.date === activeDate}
                    dropTarget={drag?.over === day.date}
                    canAdd={editable}
                    onAdd={() => addRow(day.date)}
                    onFocus={() => setFocusDate(day.date)}
                    onArrow={(key) => moveFocus(stepDay(day.date, key, options.showWeekends))}
                    more={
                      more > 0 ? (
                        <MoreItems date={day.date} count={more}>
                          {cardsOf(byDay.get(day.date) ?? [])}
                        </MoreItems>
                      ) : null
                    }
                  >
                    {cardsOf(shown)}
                  </DayCell>
                );
              })}
            </div>
          ))}
        </div>

        {noDateOpen && (
          <section
            id={noDateId}
            aria-label={CALENDAR_TEXT.noDate}
            className="flex w-64 shrink-0 flex-col gap-1 rounded border border-border p-2 max-md:w-full"
          >
            <p className="text-small font-medium">{CALENDAR_TEXT.noDate}</p>
            {placed.undated.length === 0 ? (
              <p className="text-label text-muted">{CALENDAR_TEXT.noDateEmpty}</p>
            ) : (
              <>
                {editable && <p className="text-label text-muted">{CALENDAR_TEXT.noDateHint}</p>}
                {placed.undated.map((row) => card(row, null, null))}
              </>
            )}
          </section>
        )}
      </div>

      {data.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          loading={loadingMore}
          onClick={() => actions.loadMore().catch(ignore)}
        >
          {CALENDAR_TEXT.loadMore}
        </Button>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {moving && (
        <MoveToDateDialog
          title={cardTitle(moving)}
          initial={
            movingValue
              ? (datedRow(moving.id, movingValue, viewer.timeZone)?.start ?? today)
              : today
          }
          onClose={() => setMovingId(null)}
          onMove={(date) => {
            setMovingId(null);
            save(
              moving,
              movingValue ? moveStartTo(movingValue, date, viewer.timeZone) : dayValue(date),
              date,
            );
          }}
        />
      )}
    </div>
  );
}

/** The stored value as a date value, or null when there's none to move. */
const datedValue = (value: unknown): DateValue | null => (isValidDateValue(value) ? value : null);

interface DayCellProps {
  day: CalendarDay;
  mode: CalendarMode;
  /** The day that takes Tab focus in the grid. */
  active: boolean;
  dropTarget: boolean;
  canAdd: boolean;
  onAdd(): void;
  onFocus(): void;
  onArrow(key: Arrow): void;
  more: ReactNode;
  children: ReactNode;
}

function DayCell({
  day,
  mode,
  active,
  dropTarget,
  canAdd,
  onAdd,
  onFocus,
  onArrow,
  more,
  children,
}: DayCellProps) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    // Only a press on the day itself: not a card, a button, or a menu drawn over the page.
    if (!canAdd || !(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest('button, a, input, [data-row-id]')) return;
    onAdd();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' && canAdd) {
      event.preventDefault();
      onAdd();
    } else if (isArrow(event.key)) {
      event.preventDefault();
      onArrow(event.key);
    }
  };
  return (
    <div
      role="gridcell"
      data-testid="calendar-day"
      data-date={day.date}
      aria-label={dayName(day.date)}
      aria-current={day.today ? 'date' : undefined}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocus();
      }}
      className={cn(
        'group/day flex min-w-0 flex-col gap-1 border-r border-border p-1 last:border-r-0 focus-visible:outline-offset-inset',
        mode === 'month' ? 'min-h-28' : 'min-h-96',
        !day.inMonth && 'bg-fill',
        dropTarget && 'bg-fill-hover',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-label',
            day.today ? 'bg-primary font-semibold text-primary-fg' : !day.inMonth && 'text-muted',
          )}
        >
          {dayNumber(day.date)}
        </span>
        {canAdd && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={CALENDAR_TEXT.newOnDay(day.date)}
            onClick={onAdd}
            className="flex size-6 items-center justify-center rounded-sm text-muted opacity-0 hover:bg-fill-hover group-hover/day:opacity-100"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {children}
      {more}
    </div>
  );
}

/** "+N more": the day's whole list, over the calendar. */
function MoreItems({
  date,
  count,
  children,
}: {
  date: CalendarDate;
  count: number;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="self-start rounded-sm px-1.5 text-label text-muted hover:bg-fill-hover"
        >
          {CALENDAR_TEXT.more(count)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={dayName(date)} className="flex flex-col gap-1 p-2">
        <p className="px-1 text-label font-medium text-muted">{dayName(date)}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
