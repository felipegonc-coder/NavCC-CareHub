/**
 * The timeline layout (Databases spec 3.3): a table of rows on the left and, on the right, a bar
 * for each row from the view's date property (a range) or its start and end properties. Zoom from
 * hours to years, scroll sideways to move in time. Drag a bar to move it and its ends to change
 * them, or pick it up with Space and move it with the arrow keys. Click the empty line of a row
 * without dates to place it there. Dependencies draw arrows from each blocking row to the rows it
 * blocks, and moving a blocker later shifts what it blocks (Shift on).
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIn, type DateValue, type Id, type Property, type Row } from '@carehub/databases';
import { dependencyArrows, planDependencyShift } from '@carehub/databases/dependencies';
import {
  breakpoints,
  Button,
  cn,
  colorClasses,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  useMediaQuery,
} from '@carehub/ui';
import { CellView, rowCell } from '../cells';
import {
  cellContext,
  loadMoreKey,
  type LayoutProps,
  type QueryGroup,
  type QueryRow,
} from '../contract';
import { timelineOptions } from '../filters/layout-model';
import { DependencyArrows } from './arrows';
import { TimelineBar } from './bar';
import { useCollapsed } from './collapsed';
import { DRAG_START, followDrag, swallowNextClick } from './drag';
import { Backdrop, TimeHeader } from './header';
import { pointLabel, SCALE_LABELS, TIMELINE_TEXT } from './messages';
import {
  asDateValue,
  changedBar,
  changedValues,
  dayAtX,
  dayMinutes,
  dayValue,
  dragMinutes,
  extendWindow,
  instantMinutes,
  isNoChange,
  minBarMinutes,
  minutesToX,
  NO_CHANGE,
  rowBar,
  SCALE_SPECS,
  stepMinutes,
  TIMELINE_SCALES,
  timelineLines,
  timeWindow,
  windowWidth,
  type Bar,
  type BarBox,
  type BarChange,
  type BarEdit,
  type TimelineLine,
  type TimelineScale,
} from './model';
import { Notice } from './notice';

/** Heights of a line and of the dates over the lines, px (the table and the bars share them). */
const LINE_HEIGHT = 36;
const HEADER_HEIGHT = 48;
/** Space above and below a bar in its line, px. */
const BAR_INSET = 6;
/** Earlier and Later scroll this share of what's on screen. */
const SCREEN_SHARE = 0.8;
/** Today and Zoom put today this far across. */
const TODAY_AT = 1 / 3;
const PHONE = `not all and (min-width: ${breakpoints.md})`;

const ignore = () => undefined;

const isScale = (value: string): value is TimelineScale =>
  (TIMELINE_SCALES as readonly string[]).includes(value);

const rowTitle = (row: Pick<QueryRow, 'title'>): string =>
  row.title.trim() || TIMELINE_TEXT.untitled;

/** The dependency helpers read saved rows. */
const savedRow = (row: QueryRow): Row => ({
  ...row,
  createdAt: row.createdAt ?? '',
  editedAt: row.editedAt ?? '',
});

/** A bar being dragged, or picked up with the keyboard, and how far it has gone. */
interface Changing {
  rowId: Id;
  change: BarChange;
  picked: boolean;
}

export default function TimelineLayout({
  meta,
  view,
  data,
  viewer,
  actions,
  readOnly,
}: LayoutProps) {
  const options = timelineOptions(view, meta.properties);
  const startProperty = meta.properties.find(
    (p) => p.id === options.showBy && p.config.type === 'date',
  );
  const endProperty =
    startProperty && options.endBy !== startProperty.id
      ? meta.properties.find((p) => p.id === options.endBy && p.config.type === 'date')
      : undefined;
  const editable = !readOnly && startProperty !== undefined;
  const phone = useMediaQuery(PHONE);
  // Phones show the bars only (spec 3.3).
  const tableShown = options.showTable && !phone;

  const [chosenScale, setChosenScale] = useState<TimelineScale | null>(null);
  const scale = chosenScale ?? options.scale;
  const [more, setMore] = useState({ scale, before: 0, after: 0 });
  const [changing, setChanging] = useState<Changing | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, toggleCollapsed] = useCollapsed(meta.id, view.id, viewer.userId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const shownScale = useRef<TimelineScale | null>(null);
  const shownStart = useRef<string | null>(null);
  const pendingScroll = useRef(0);
  const hintId = useId();

  useEffect(() => () => stopDrag.current?.(), []);

  const rows = useMemo(
    () => (data.groups ? data.groups.flatMap((g) => g.rows) : data.rows),
    [data.groups, data.rows],
  );
  const bars = useMemo(() => {
    const found = new Map<Id, Bar>();
    if (!startProperty) return found;
    for (const row of rows) {
      const bar = rowBar(
        row.id,
        rowCell(row, startProperty).value,
        endProperty ? rowCell(row, endProperty).value : null,
        endProperty !== undefined,
        viewer.timeZone,
      );
      if (bar) found.set(row.id, bar);
    }
    return found;
  }, [rows, startProperty, endProperty, viewer.timeZone]);

  const today = todayIn(viewer);
  const now = instantMinutes(viewer.now, viewer.timeZone);
  const baseFrame = useMemo(
    () => timeWindow([...bars.values()], today, scale, viewer.weekStart),
    [bars, today, scale, viewer.weekStart],
  );
  const frame =
    more.scale === scale
      ? extendWindow(baseFrame, more.before, more.after, viewer.weekStart)
      : baseFrame;
  const frameWidth = windowWidth(frame);
  const dayWidth = SCALE_SPECS[scale].dayWidth;

  // Zooming (and the first draw) puts today in view; more time added before keeps what's on screen.
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    if (shownScale.current !== scale) {
      shownScale.current = scale;
      pane.scrollLeft = Math.max(0, minutesToX(frame, now) - pane.clientWidth * TODAY_AT);
    } else if (shownStart.current !== null && shownStart.current !== frame.start) {
      pane.scrollLeft += minutesToX(frame, dayMinutes(shownStart.current));
    }
    if (pendingScroll.current !== 0) {
      pane.scrollLeft += pendingScroll.current;
      pendingScroll.current = 0;
    }
    shownStart.current = frame.start;
  });

  const lines = timelineLines(data.rows, data.groups, bars, collapsed, data.nextCursor !== null);
  const ctx = useMemo(() => cellContext(meta, data, viewer), [meta, data, viewer]);
  const propertiesById = useMemo(
    () => new Map(meta.properties.map((p) => [p.id, p])),
    [meta.properties],
  );
  const shownProperties = (ids: readonly Id[]): Property[] =>
    ids
      .map((id) => propertiesById.get(id))
      .filter((p): p is Property => p !== undefined && p.config.type !== 'title');
  const tableProperties = shownProperties(
    options.tableProperties.filter((s) => s.visible).map((s) => s.propertyId),
  );
  const barProperties = shownProperties(
    options.barPropertyIds ?? view.properties.filter((s) => s.visible).map((s) => s.propertyId),
  );
  const titleName =
    meta.properties.find((p) => p.config.type === 'title')?.name ?? TIMELINE_TEXT.name;

  // ------------------------------------------------------------ dependencies

  const dependencies = meta.dependencies ?? null;
  const dates = startProperty
    ? {
        startPropertyId: startProperty.id,
        endPropertyId: endProperty?.id ?? null,
        timeZone: viewer.timeZone,
      }
    : null;
  const savedRows = useMemo(() => rows.map(savedRow), [rows]);
  const arrows =
    dependencies && dates && options.showDependencies === true
      ? dependencyArrows(savedRows, dependencies, dates)
      : [];

  // ------------------------------------------------------------ changes

  const startOf = (row: QueryRow): DateValue | null =>
    startProperty ? asDateValue(rowCell(row, startProperty).value) : null;
  const endOf = (row: QueryRow): DateValue | null =>
    endProperty ? asDateValue(rowCell(row, endProperty).value) : null;
  /** Whether the edit changes a value with a time (they move by 15 minutes on Hours). */
  const timed = (row: QueryRow, edit: BarEdit): boolean =>
    (edit === 'end' && endProperty ? (endOf(row) ?? startOf(row)) : startOf(row))?.hasTime ?? false;

  const commit = (row: QueryRow, values: Record<Id, DateValue>, message: string) => {
    if (Object.keys(values).length === 0) return;
    setAnnouncement(message);
    actions.updateValues(row.id, values).catch(ignore);
    if (!dependencies || !dates) return;
    // With Shift on, the rows it blocks move later with it (spec 3.13).
    const plan = planDependencyShift(savedRows, dependencies, dates, { rowId: row.id, values });
    const shifted = new Map<Id, Record<Id, DateValue>>();
    for (const shift of plan.changes) {
      shifted.set(shift.rowId, { ...shifted.get(shift.rowId), [shift.propertyId]: shift.value });
    }
    for (const [rowId, next] of shifted) actions.updateValues(rowId, next).catch(ignore);
    if (plan.message) setNotice(plan.message);
  };

  const save = (row: QueryRow, change: BarChange) => {
    const start = startOf(row);
    if (!startProperty || !start || isNoChange(change)) return;
    const endId = endProperty?.id ?? null;
    const values = changedValues(
      change,
      start,
      endOf(row),
      startProperty.id,
      endId,
      viewer.timeZone,
    );
    const title = rowTitle(row);
    const first = values[startProperty.id] ?? start;
    const zone = (v: DateValue) => v.timeZone ?? viewer.timeZone;
    let message: string;
    if (change.move !== 0 || change.start !== 0) {
      message = TIMELINE_TEXT.moved(
        title,
        pointLabel(first.start, first.hasTime, zone(first), viewer.hour12),
      );
    } else {
      const last = (endId ? (values[endId] ?? endOf(row)) : null) ?? first;
      const point = last.end ?? last.start;
      message = TIMELINE_TEXT.ends(
        title,
        pointLabel(point, last.hasTime, zone(last), viewer.hour12),
      );
    }
    commit(row, values, message);
  };

  /** A row without dates gets the day that was clicked (start and end, with an end property). */
  const place = (row: QueryRow, date: string) => {
    if (!editable || !startProperty) return;
    const values: Record<Id, DateValue> = { [startProperty.id]: dayValue(date) };
    if (endProperty) values[endProperty.id] = dayValue(date);
    commit(
      row,
      values,
      TIMELINE_TEXT.moved(rowTitle(row), pointLabel(date, false, viewer.timeZone, viewer.hour12)),
    );
  };

  const startDrag = (event: PointerEvent<HTMLElement>, row: QueryRow, edit: BarEdit) => {
    // Phones change dates in the row, not by dragging (spec 3.3).
    if (!editable || event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    const hasTime = timed(row, edit);
    const changeFor = (dx: number): BarChange => ({
      ...NO_CHANGE,
      [edit]: dragMinutes(dx, scale, hasTime),
    });
    let active = false;
    stopDrag.current?.();
    stopDrag.current = followDrag(event.clientX, {
      move: (dx) => {
        if (!active && Math.abs(dx) < DRAG_START) return;
        active = true;
        setChanging({ rowId: row.id, change: changeFor(dx), picked: false });
      },
      escape: () => setChanging(null),
      end: (dx, cancelled) => {
        stopDrag.current = null;
        if (!active) return;
        swallowNextClick();
        setChanging(null);
        if (!cancelled) save(row, changeFor(dx));
      },
    });
  };

  /** Up and down go from bar to bar (and to the lines of rows without dates). */
  const focusNext = (from: HTMLElement, step: number) => {
    const all = [...(linesRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? [])];
    all[all.indexOf(from) + step]?.focus();
  };

  const onBarKey = (event: KeyboardEvent<HTMLElement>, row: QueryRow) => {
    const title = rowTitle(row);
    const held = changing?.picked && changing.rowId === row.id ? changing : null;
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (held) {
          setChanging(null);
          if (isNoChange(held.change)) setAnnouncement(TIMELINE_TEXT.dropped(title));
          else save(row, held.change);
        } else actions.openRow(row.id);
        return;
      case ' ':
        event.preventDefault();
        if (!editable) actions.openRow(row.id);
        else if (held) {
          setChanging(null);
          if (isNoChange(held.change)) setAnnouncement(TIMELINE_TEXT.dropped(title));
          else save(row, held.change);
        } else {
          setChanging({ rowId: row.id, change: NO_CHANGE, picked: true });
          setAnnouncement(TIMELINE_TEXT.picked(title));
        }
        return;
      case 'Escape':
        if (!held) return;
        event.preventDefault();
        setChanging(null);
        setAnnouncement(TIMELINE_TEXT.cancelled(title));
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!held) return;
        event.preventDefault();
        const edit: BarEdit = event.shiftKey ? 'end' : 'move';
        const step = stepMinutes(scale, timed(row, edit)) * (event.key === 'ArrowLeft' ? -1 : 1);
        setChanging({ ...held, change: { ...held.change, [edit]: held.change[edit] + step } });
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (held) return;
        event.preventDefault();
        focusNext(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1);
        return;
    }
  };

  const changeScale = (next: TimelineScale) => {
    setChosenScale(next);
    if (next !== options.scale) {
      actions.updateView({ timeline: { ...options, scale: next } }).catch(ignore);
    }
  };

  const scrollToToday = () => {
    const pane = scrollRef.current;
    if (pane) pane.scrollLeft = Math.max(0, minutesToX(frame, now) - pane.clientWidth * TODAY_AT);
  };

  /** One screen earlier or later; at the end of the time drawn, more is added on that side. */
  const scrollScreen = (direction: -1 | 1) => {
    const pane = scrollRef.current;
    if (!pane) return;
    const step = Math.max(pane.clientWidth * SCREEN_SHARE, dayWidth);
    const room =
      direction < 0 ? pane.scrollLeft : pane.scrollWidth - pane.clientWidth - pane.scrollLeft;
    if (room >= step) {
      pane.scrollLeft += direction * step;
      return;
    }
    const days = Math.ceil(step / dayWidth) + SCALE_SPECS[scale].padDays;
    pendingScroll.current = direction * step;
    setMore((m) => {
      const base = m.scale === scale ? m : { scale, before: 0, after: 0 };
      return direction < 0
        ? { ...base, before: base.before + days }
        : { ...base, after: base.after + days };
    });
  };

  // ------------------------------------------------------------ drawing

  if (!startProperty) {
    return (
      <div className="flex flex-col items-start gap-2 px-2 py-6">
        <p className="text-body text-muted">{TIMELINE_TEXT.noShowBy}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => actions.openPanel('layout', undefined, event.currentTarget)}
        >
          {TIMELINE_TEXT.chooseShowBy}
        </Button>
      </div>
    );
  }

  const shownBar = (row: QueryRow, bar: Bar): Bar =>
    changing?.rowId === row.id
      ? changedBar(bar, changing.change, minBarMinutes(startOf(row)?.hasTime ?? false))
      : bar;
  const boxes = new Map<Id, BarBox>();
  lines.forEach((line, index) => {
    if (line.kind !== 'row' || !line.bar) return;
    const bar = shownBar(line.row, line.bar);
    boxes.set(line.row.id, {
      left: minutesToX(frame, bar.start),
      right: minutesToX(frame, bar.end),
      y: index * LINE_HEIGHT + LINE_HEIGHT / 2,
    });
  });

  const loadMore = (groupKey: string | undefined) => (
    <Button
      variant="ghost"
      size="sm"
      loading={data.loadingMore.includes(loadMoreKey(groupKey))}
      onClick={() => actions.loadMore(groupKey).catch(ignore)}
    >
      {TIMELINE_TEXT.loadMore}
    </Button>
  );

  const groupHeader = (group: QueryGroup, isCollapsed: boolean) => (
    <span className="flex min-w-0 items-center gap-1">
      <IconButton
        label={
          isCollapsed ? TIMELINE_TEXT.expand(group.label) : TIMELINE_TEXT.collapse(group.label)
        }
        size="sm"
        aria-expanded={!isCollapsed}
        onClick={() => toggleCollapsed(group.collapsedKey)}
      >
        {isCollapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
      </IconButton>
      <span
        className={cn(
          'truncate rounded-sm px-1.5 text-small font-medium',
          group.color && group.color !== 'default' && colorClasses[group.color].bg,
        )}
      >
        {group.label}
      </span>
      <span className="text-small text-muted">{group.count}</span>
    </span>
  );

  /** What a line says on the left (the table), or over the bars when there's no table. */
  const lineLabel = (line: TimelineLine): ReactNode => {
    switch (line.kind) {
      case 'group':
        return groupHeader(line.group, line.collapsed);
      case 'no-date':
        return (
          <span className="flex items-center gap-1 px-1 text-small font-medium">
            {TIMELINE_TEXT.noDate} <span className="text-muted">{line.count}</span>
          </span>
        );
      case 'more':
        return loadMore(line.groupKey);
      case 'row':
        return null;
    }
  };

  const table = tableShown && (
    <div
      role="table"
      aria-label={TIMELINE_TEXT.table}
      className="sticky left-0 z-20 flex shrink-0 flex-col border-r border-border bg-bg"
    >
      <div
        role="row"
        className="flex items-end border-b border-border"
        style={{ height: HEADER_HEIGHT }}
      >
        <span role="columnheader" className="w-48 truncate px-2 pb-1 text-label text-muted">
          {titleName}
        </span>
        {tableProperties.map((property) => (
          <span
            key={property.id}
            role="columnheader"
            className="w-32 truncate px-2 pb-1 text-label text-muted"
          >
            {property.name}
          </span>
        ))}
      </div>
      {lines.map((line) => (
        <div
          key={line.key}
          role="row"
          className={cn(
            'flex items-center border-b border-border',
            line.kind === 'group' && 'bg-fill',
          )}
          style={{ height: LINE_HEIGHT }}
        >
          {line.kind === 'row' ? (
            <>
              <span role="cell" className="flex w-48 min-w-0 px-2">
                <button
                  type="button"
                  className="truncate text-left text-small text-fg hover:underline"
                  onClick={() => actions.openRow(line.row.id)}
                >
                  {rowTitle(line.row)}
                </button>
              </span>
              {tableProperties.map((property) => (
                <span key={property.id} role="cell" className="flex w-32 min-w-0 px-2">
                  <CellView
                    property={property}
                    {...rowCell(line.row, property)}
                    ctx={ctx}
                    wrap={false}
                    className="min-w-0 truncate text-small"
                  />
                </span>
              ))}
            </>
          ) : (
            <span role="cell" className="flex min-w-0 px-1">
              {lineLabel(line)}
            </span>
          )}
        </div>
      ))}
    </div>
  );

  const lane = (row: QueryRow) =>
    editable ? (
      <div
        role="button"
        tabIndex={0}
        data-line=""
        aria-label={TIMELINE_TEXT.place(rowTitle(row))}
        className="absolute inset-0 cursor-copy outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={(event) =>
          place(
            row,
            dayAtX(frame, event.clientX - event.currentTarget.getBoundingClientRect().left),
          )
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            place(row, today);
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            focusNext(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1);
          }
        }}
      />
    ) : null;

  const paneLine = (line: TimelineLine) => {
    const label = tableShown ? null : lineLabel(line);
    if (line.kind !== 'row') {
      return (
        <div
          key={line.key}
          className={cn('relative border-b border-border', line.kind === 'group' && 'bg-fill')}
          style={{ height: LINE_HEIGHT }}
        >
          {label && (
            <div className="sticky left-0 z-10 flex h-full w-max items-center px-1">{label}</div>
          )}
        </div>
      );
    }
    const { row } = line;
    const bar = line.bar ? shownBar(row, line.bar) : null;
    return (
      <div
        key={line.key}
        className="relative border-b border-border"
        style={{ height: LINE_HEIGHT }}
      >
        {bar ? (
          <TimelineBar
            row={row}
            title={rowTitle(row)}
            left={minutesToX(frame, bar.start)}
            width={Math.max(minutesToX(frame, bar.end) - minutesToX(frame, bar.start), 2)}
            top={BAR_INSET}
            height={LINE_HEIGHT - 2 * BAR_INSET}
            properties={barProperties}
            ctx={ctx}
            editable={editable}
            changing={changing?.rowId === row.id}
            hintId={editable ? hintId : undefined}
            onPressStart={(event, edit) => startDrag(event, row, edit)}
            onOpen={() => actions.openRow(row.id)}
            onKeyDown={(event) => onBarKey(event, row)}
            onBlur={() => {
              if (changing?.picked && changing.rowId === row.id) setChanging(null);
            }}
          />
        ) : (
          <>
            {lane(row)}
            {!tableShown && (
              <span className="pointer-events-none sticky left-0 flex h-full w-max items-center px-2 text-small text-muted">
                {rowTitle(row)}
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="secondary" size="sm" onClick={scrollToToday}>
          {TIMELINE_TEXT.today}
        </Button>
        <IconButton label={TIMELINE_TEXT.earlier} size="sm" onClick={() => scrollScreen(-1)}>
          <ChevronLeft aria-hidden />
        </IconButton>
        <IconButton label={TIMELINE_TEXT.later} size="sm" onClick={() => scrollScreen(1)}>
          <ChevronRight aria-hidden />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto">
              <span className="text-muted">{TIMELINE_TEXT.zoom}</span> {SCALE_LABELS[scale]}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={scale}
              onValueChange={(value) => {
                if (isScale(value)) changeScale(value);
              }}
            >
              {TIMELINE_SCALES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SCALE_LABELS[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded border border-border">
        <div className="flex w-max">
          {table}
          <div
            role="group"
            aria-label={TIMELINE_TEXT.timeline}
            className="relative shrink-0"
            style={{ width: frameWidth }}
          >
            <TimeHeader
              window={frame}
              weekStart={viewer.weekStart}
              hour12={viewer.hour12}
              height={HEADER_HEIGHT}
            />
            <div ref={linesRef} className="relative">
              <Backdrop
                window={frame}
                weekStart={viewer.weekStart}
                showWeekends={options.showWeekends !== false}
                now={now}
              />
              {lines.map(paneLine)}
              <DependencyArrows
                arrows={arrows}
                boxes={boxes}
                width={frameWidth}
                height={lines.length * LINE_HEIGHT}
                turn={LINE_HEIGHT / 2}
              />
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <p id={hintId} className="sr-only">
          {TIMELINE_TEXT.barHint}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice && <Notice text={notice} onShown={() => setNotice(null)} />}
    </div>
  );
}
