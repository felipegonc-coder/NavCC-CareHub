import { Button, Card, CardHeader, CardTitle, VisuallyHidden, cn } from '@carehub/ui';
import { useId, useState, type KeyboardEvent } from 'react';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DayNumbers } from './api';
import { DataTable, type Column } from './data-table';
import { countOf, countText, dayText, shortDayText } from './format';

/** One number per day, with its names and the token class that colours it. */
export interface Series {
  key: 'activePeople' | 'views' | 'edits' | 'created';
  /** Column header and legend, such as "Page views". */
  label: string;
  /** For read-outs: "1 view", "2 views". */
  one: string;
  many: string;
  /** A design kit text colour; the chart draws in currentColor. */
  tone: 'text-fg' | 'text-muted';
}

interface DayChartProps {
  title: string;
  kind: 'line' | 'bar';
  series: readonly Series[];
  days: readonly DayNumbers[];
  /** Export CSV of the table view saves `<fileName>.csv`. */
  fileName: string;
  testId: string;
}

/** Slider keys (WAI-ARIA slider pattern): a day at a time, a week at a time, first and last. */
const KEY_STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowLeft: (index) => index - 1,
  ArrowDown: (index) => index - 1,
  ArrowRight: (index) => index + 1,
  ArrowUp: (index) => index + 1,
  PageDown: (index) => index - 7,
  PageUp: (index) => index + 7,
  Home: () => 0,
  End: (_index, last) => last,
};

/** "October 21, 2026: 12 views, 3 edits". */
export function dayReadout(day: DayNumbers, series: readonly Series[]): string {
  return `${dayText(day.day)}: ${series.map((s) => countOf(day[s.key], s.one, s.many)).join(', ')}`;
}

const SWATCH: Record<Series['tone'], string> = { 'text-fg': 'bg-fg', 'text-muted': 'bg-muted' };

/** The tooltip under the pointer. recharts fills in `active` and `label`. */
function PointerReadout({
  active,
  label,
  days,
  series,
}: {
  active?: boolean;
  label?: unknown;
  days: readonly DayNumbers[];
  series: readonly Series[];
}) {
  const day = active ? days.find((candidate) => candidate.day === label) : undefined;
  if (!day) return null;
  return (
    <p className="rounded border border-border bg-bg px-2 py-1 text-small text-fg shadow-menu">
      {dayReadout(day, series)}
    </p>
  );
}

/**
 * A chart of numbers per day. "View as table" shows the same numbers as a table (AN-10). From the
 * keyboard the chart is a slider over its days: arrow keys, Page Up/Down, Home and End move from
 * day to day, and screen readers say each day's numbers. The drawing itself is hidden from them.
 */
export function DayChart({ title, kind, series, days, fileName, testId }: DayChartProps) {
  const [asTable, setAsTable] = useState(false);
  // The day the keyboard is on: the latest one until another is chosen.
  const [chosen, setChosen] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const titleId = useId();
  const hintId = useId();
  const last = days.length - 1;
  const index = Math.max(0, Math.min(chosen ?? last, last));
  const current = days[index];
  const readout = current ? dayReadout(current, series) : '';

  const onKeyDown = (event: KeyboardEvent) => {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    setChosen(Math.max(0, Math.min(last, step(index, last))));
  };

  const columns: Column<DayNumbers>[] = [
    { key: 'day', label: 'Day', value: (day) => day.day, render: (day) => dayText(day.day) },
    ...series.map((s): Column<DayNumbers> => ({
      key: s.key,
      label: s.label,
      value: (day) => day[s.key],
      render: (day) => countText(day[s.key]),
      numeric: true,
    })),
  ];

  const axis = { stroke: 'currentColor', tick: { fill: 'currentColor' }, tickLine: false } as const;
  const chartProps = {
    data: [...days],
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
    // The arrow keys are handled around the chart, so recharts' own keyboard layer is off.
    accessibilityLayer: false,
  };
  const children = (
    <>
      <XAxis
        dataKey="day"
        tickFormatter={shortDayText}
        interval="preserveStartEnd"
        minTickGap={24}
        {...axis}
      />
      <YAxis allowDecimals={false} width={40} axisLine={false} {...axis} />
      <Tooltip
        content={<PointerReadout days={days} series={series} />}
        cursor={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
        isAnimationActive={false}
      />
      {focused && current && (
        <ReferenceLine x={current.day} stroke="currentColor" strokeDasharray="3 3" />
      )}
    </>
  );

  return (
    <Card className="flex flex-col gap-3" data-testid={testId}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" id={titleId}>
          {title}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((shown) => !shown)}>
          {asTable ? 'View as chart' : 'View as table'}
        </Button>
      </CardHeader>
      {asTable ? (
        <DataTable
          caption={title}
          columns={columns}
          rows={days}
          rowKey={(day) => day.day}
          sortedBy={{ key: 'day', direction: 'ascending' }}
          fileName={fileName}
          testId={`${testId}-table`}
        />
      ) : (
        <>
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-4 text-small text-muted" aria-hidden>
              {series.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className={cn('size-2.5 rounded-sm', SWATCH[s.tone])} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <div
            role="slider"
            tabIndex={0}
            aria-labelledby={titleId}
            aria-describedby={hintId}
            aria-valuemin={1}
            aria-valuemax={days.length}
            aria-valuenow={index + 1}
            aria-valuetext={readout}
            className="rounded text-label text-muted"
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <div aria-hidden className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {kind === 'line' ? (
                  <LineChart {...chartProps}>
                    {children}
                    {series.map((s) => (
                      <Line
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        type="monotone"
                        stroke="currentColor"
                        strokeWidth={2}
                        dot={false}
                        className={s.tone}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart {...chartProps}>
                    {children}
                    {series.map((s) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        fill="currentColor"
                        className={s.tone}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
          <VisuallyHidden id={hintId}>
            Use the left and right arrow keys to read each day.
          </VisuallyHidden>
          {/* The day the keyboard is on, for people who see the screen; screen readers say it. */}
          <p className="min-h-5 text-small" data-testid={`${testId}-readout`}>
            {focused && readout}
          </p>
        </>
      )}
    </Card>
  );
}
